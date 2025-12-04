/**
 * Update Exit Plan Tool
 * Tighten stops/targets without widening risk
 */

import { tool } from "ai";
import { z } from "zod";

import { ToolCallType } from "@/server/db/tradingRepository";
import { createToolCallMutation } from "@/server/db/tradingRepository.server";
import {
	getOpenOrderBySymbol,
	updateOrderExitPlan,
} from "@/server/db/ordersRepository.server";
import { DEFAULT_SIMULATOR_OPTIONS, IS_SIMULATION_ENABLED } from "@/env";
import { ExchangeSimulator } from "@/server/features/simulator/exchangeSimulator";
import {
	computeRiskMetrics,
	resolveNotionalUsd,
	resolveQuantity,
} from "@/server/features/trading/openPositionEnrichment";
import type {
	ExitPlanSummary,
	OpenPositionSummary,
} from "@/server/features/trading/openPositions";
import type { TradingSignal } from "@/server/features/trading/tradingDecisions";

import { marketSymbols } from "../schemas";
import type { ToolContext } from "./types";

/**
 * Creates the updateExitPlan tool with the given context
 */
export function updateExitPlanTool(ctx: ToolContext) {
	return tool({
		description: "Tighten stops/targets without widening risk",
		inputSchema: z.object({
			updates: z
				.array(
					z.object({
						symbol: z.enum(marketSymbols as unknown as [string, ...string[]]),
						new_stop_loss: z
							.number()
							.describe("New stop price (must tighten, not widen)"),
						new_target_price: z
							.number()
							.optional()
							.nullable()
							.describe("Optional new target"),
						reason: z.string().min(3).describe("Per-symbol justification"),
					}),
				)
				.min(1),
		}),
		execute: async ({ updates }) => {
			const decisionsPayload: Array<{
				symbol: string;
				signal: TradingSignal;
				quantity: number;
				profitTarget: number | null;
				stopLoss: number | null;
				invalidationCondition: string | null;
				leverage: number | null;
				confidence: number | null;
				reason: string | null;
			}> = [];
			const resultsPayload: Array<{
				symbol: string;
				success: boolean;
				error?: string | null;
			}> = [];
			const successSummaries: string[] = [];
			const failureSummaries: string[] = [];
			const skippedDuplicates: string[] = [];
			const nowIso = new Date().toISOString();
			let simulatorInstance: ExchangeSimulator | null = null;

			for (const update of updates) {
				const normalizedSymbol = update.symbol.toUpperCase();

				// Check if already acted on this symbol
				if (ctx.actedSymbols.has(normalizedSymbol)) {
					skippedDuplicates.push(normalizedSymbol);
					continue;
				}

				const position = ctx.openPositions.find(
					(pos) => pos.symbol?.toUpperCase() === normalizedSymbol,
				);

				if (!position) {
					const message = `No open position found for ${normalizedSymbol}.`;
					resultsPayload.push({
						symbol: normalizedSymbol,
						success: false,
						error: message,
					});
					failureSummaries.push(message);
					continue;
				}

				if (
					!Number.isFinite(update.new_stop_loss) ||
					update.new_stop_loss <= 0
				) {
					const message = `Invalid stop provided for ${normalizedSymbol}.`;
					resultsPayload.push({
						symbol: normalizedSymbol,
						success: false,
						error: message,
					});
					failureSummaries.push(message);
					continue;
				}

				const stopValue = Number(update.new_stop_loss);
				const currentStop = position.exitPlan?.stop ?? null;
				const tolerance = 1e-6;

				if (currentStop !== null) {
					if (
						position.sign === "LONG" &&
						stopValue + tolerance < currentStop
					) {
						const message = `Rejected: new stop widens risk (current ${currentStop.toFixed(4)}).`;
						resultsPayload.push({
							symbol: normalizedSymbol,
							success: false,
							error: message,
						});
						failureSummaries.push(message);
						continue;
					}
					if (
						position.sign === "SHORT" &&
						stopValue - tolerance > currentStop
					) {
						const message = `Rejected: new stop widens risk (current ${currentStop.toFixed(4)}).`;
						resultsPayload.push({
							symbol: normalizedSymbol,
							success: false,
							error: message,
						});
						failureSummaries.push(message);
						continue;
					}
				}

				const targetValue =
					typeof update.new_target_price === "number" &&
					Number.isFinite(update.new_target_price)
						? Number(update.new_target_price)
						: (position.exitPlan?.target ?? null);

				const updatedExitPlan: ExitPlanSummary = {
					target: targetValue,
					stop: stopValue,
					invalidation: update.reason,
				};

				position.exitPlan = updatedExitPlan;
				const basePosition = position as OpenPositionSummary;
				const notional =
					position.notionalUsd ?? resolveNotionalUsd(basePosition);
				const recalculatedRisk = computeRiskMetrics(
					basePosition,
					updatedExitPlan,
					notional,
				);
				position.riskUsd = recalculatedRisk.riskUsd;
				position.riskPercent = recalculatedRisk.riskPercent;
				position.rewardUsd = recalculatedRisk.rewardUsd;
				position.rewardPercent = recalculatedRisk.rewardPercent;
				position.riskRewardRatio = recalculatedRisk.riskRewardRatio;
				position.lastDecisionAt = nowIso;
				position.decisionStatus = "UPDATED";

				const decisionQuantity = resolveQuantity(basePosition) ?? 0;

				if (IS_SIMULATION_ENABLED) {
					simulatorInstance =
						simulatorInstance ??
						(await ExchangeSimulator.bootstrap(DEFAULT_SIMULATOR_OPTIONS));
					const accountId = ctx.account.id || "default";
					simulatorInstance.setExitPlan(accountId, normalizedSymbol, {
						stop: updatedExitPlan.stop,
						target: updatedExitPlan.target,
						invalidation: updatedExitPlan.invalidation,
					});
				}

				// Update exitPlan in Orders table (single source of truth)
				try {
					const accountId = ctx.account.id || "default";
					const dbOrder = await getOpenOrderBySymbol(
						accountId,
						normalizedSymbol,
					);
					if (dbOrder) {
						await updateOrderExitPlan({
							orderId: dbOrder.id,
							exitPlan: {
								stop: updatedExitPlan.stop,
								target: updatedExitPlan.target,
								invalidation: updatedExitPlan.invalidation,
								confidence: position.confidence ?? null,
							},
						});
					}
				} catch (dbError) {
					console.error(
						`[updateExitPlan] DB update failed for ${normalizedSymbol}:`,
						dbError,
					);
				}

				ctx.capturedDecisions.push({
					symbol: normalizedSymbol,
					side: position.sign,
					quantity: decisionQuantity,
					leverage: position.leverage ?? null,
					profitTarget: updatedExitPlan.target,
					stopLoss: updatedExitPlan.stop,
					invalidationCondition: updatedExitPlan.invalidation,
					confidence: position.confidence ?? null,
				});

				decisionsPayload.push({
					symbol: normalizedSymbol,
					signal: position.sign as TradingSignal,
					quantity: decisionQuantity,
					profitTarget: updatedExitPlan.target,
					stopLoss: updatedExitPlan.stop,
					invalidationCondition: updatedExitPlan.invalidation,
					leverage: position.leverage ?? null,
					confidence: position.confidence ?? null,
					reason: update.reason,
				});

				resultsPayload.push({ symbol: normalizedSymbol, success: true });
				ctx.actedSymbols.add(normalizedSymbol);
				successSummaries.push(
					`${normalizedSymbol} → stop ${stopValue.toFixed(4)}${
						typeof updatedExitPlan.target === "number"
							? `, target ${updatedExitPlan.target.toFixed(4)}`
							: ""
					}`,
				);
			}

			// Return early if all were duplicates
			if (decisionsPayload.length === 0 && skippedDuplicates.length > 0) {
				return `Already acted on ${skippedDuplicates.join(", ")} this session. Call 'holding' if done.`;
			}

			if (decisionsPayload.length > 0) {
				const toolCallRecord = await createToolCallMutation({
					invocationId: ctx.invocationId,
					type: ToolCallType.CREATE_POSITION,
					metadata: JSON.stringify({
						action: "updateExitPlan",
						decisions: decisionsPayload,
						results: resultsPayload,
					}),
				});

				for (const decision of decisionsPayload) {
					ctx.decisionIndex.set(decision.symbol, {
						symbol: decision.symbol,
						signal: decision.signal,
						quantity: decision.quantity,
						leverage: decision.leverage,
						profitTarget: decision.profitTarget,
						stopLoss: decision.stopLoss,
						invalidationCondition: decision.invalidationCondition,
						confidence: decision.confidence,
						toolCallId: toolCallRecord.id,
						toolCallType: "UPDATE_EXIT_PLAN",
						createdAt: toolCallRecord.createdAt,
						result: { symbol: decision.symbol, success: true },
					});
				}
			}

			if (successSummaries.length === 0 && failureSummaries.length === 0) {
				return skippedDuplicates.length > 0
					? `Skipped (already acted): ${skippedDuplicates.join(", ")}. Call 'holding' if done.`
					: "No exit plan updates were applied.";
			}

			const responseChunks: string[] = [];
			if (successSummaries.length > 0) {
				responseChunks.push(`Updated ${successSummaries.join("; ")}.`);
			}
			if (failureSummaries.length > 0) {
				responseChunks.push(failureSummaries.join(" "));
			}
			if (skippedDuplicates.length > 0) {
				responseChunks.push(
					`Skipped (already acted): ${skippedDuplicates.join(", ")}.`,
				);
			}

			return responseChunks.join(" ") || "No exit plan updates were applied.";
		},
	});
}
