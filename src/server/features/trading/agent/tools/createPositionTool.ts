/**
 * Create Position Tool
 * Opens one or more trading positions atomically
 */

import { tool } from "ai";
import { z } from "zod";

import { ToolCallType } from "@/server/db/tradingRepository";
import { createToolCallMutation } from "@/server/db/tradingRepository.server";
import { createPosition } from "@/server/features/trading/createPosition";
import { MARKETS } from "@/shared/markets/marketMetadata";

import { decisionSchema, type NormalizedDecision } from "../schemas";
import type { ToolContext } from "./types";

/**
 * Creates the createPosition tool with the given context
 */
export function createPositionTool(ctx: ToolContext) {
	return tool({
		description: "Open one or more positions atomically",
		inputSchema: z.object({
			decisions: z.array(decisionSchema),
		}),
		execute: async ({ decisions }) => {
			const modern =
				decisions?.map((item) => ({
					symbol: item.symbol.toUpperCase(),
					side:
						item.side === "SHORT" || item.side === "LONG"
							? item.side
							: item.side === "HOLD"
								? "HOLD"
								: (item.side as string),
					quantity: item.quantity,
					leverage: item.leverage ?? null,
					profitTarget: item.profit_target ?? null,
					stopLoss: item.stop_loss ?? null,
					invalidationCondition: item.invalidation_condition ?? null,
					confidence: item.confidence ?? null,
				})) ?? [];

			const normalized: NormalizedDecision[] = [];
			const seenSymbols = new Set<string>();
			const skippedDuplicates: string[] = [];

			for (const entry of [...modern]) {
				const symbol = entry.symbol;

				// Check if already acted on this symbol this session
				if (ctx.actedSymbols.has(symbol)) {
					skippedDuplicates.push(symbol);
					continue;
				}

				const sideRaw =
					typeof entry.side === "string" ? entry.side.toUpperCase() : "HOLD";
				const validSide =
					sideRaw === "LONG" || sideRaw === "SHORT" ? sideRaw : "HOLD";
				const quantity = Number.isFinite(entry.quantity) ? entry.quantity : 0;

				if (!(symbol in MARKETS)) continue;
				if (seenSymbols.has(symbol)) continue;
				seenSymbols.add(symbol);

				normalized.push({
					symbol,
					side: validSide,
					quantity,
					leverage: entry.leverage ?? null,
					profitTarget: entry.profitTarget ?? null,
					stopLoss: entry.stopLoss ?? null,
					invalidationCondition: entry.invalidationCondition ?? null,
					confidence: entry.confidence ?? null,
				});
			}

			// Return early if all symbols were duplicates
			if (normalized.length === 0 && skippedDuplicates.length > 0) {
				return `Already acted on ${skippedDuplicates.join(", ")} this session. Call 'holding' if done.`;
			}

			const results = await createPosition(ctx.account, normalized);

			const successful = results.filter((r) => r.success);
			const failed = results.filter((r) => !r.success);

			// Mark successful symbols as acted
			for (const result of successful) {
				ctx.actedSymbols.add(result.symbol);
			}

			// Capture decisions for telemetry
			for (const decision of normalized) {
				ctx.capturedDecisions.push({
					symbol: decision.symbol,
					side: decision.side,
					quantity: decision.quantity,
					leverage: decision.leverage,
					profitTarget: decision.profitTarget,
					stopLoss: decision.stopLoss,
					invalidationCondition: decision.invalidationCondition,
					confidence: decision.confidence,
				});
			}

			// Capture execution results for telemetry
			for (const outcome of results) {
				ctx.capturedExecutionResults.push({
					symbol: outcome.symbol,
					side: outcome.side,
					quantity: outcome.quantity,
					leverage: outcome.leverage ?? null,
					success: outcome.success,
					error: outcome.error ?? null,
				});
			}

			// Record tool call in database
			await createToolCallMutation({
				invocationId: ctx.invocationId,
				type: ToolCallType.CREATE_POSITION,
				metadata: JSON.stringify({
					decisions: normalized,
					results,
				}),
			});

			// Format response
			const formatDecision = (r: (typeof results)[number]) => {
				const pieces = [r.symbol];
				if (r.side === "HOLD") {
					pieces.push("HOLD");
				} else {
					pieces.push(r.side);
				}
				if (Number.isFinite(r.quantity)) {
					pieces.push(`qty ${Math.abs(r.quantity ?? 0).toPrecision(3)}`);
				}
				if (Number.isFinite(r.leverage ?? undefined)) {
					pieces.push(`${r.leverage}x`);
				}
				return pieces.join(" ");
			};

			let response = "";
			if (successful.length > 0) {
				response += `Successfully processed: ${successful.map(formatDecision).join(", ")}. `;
			}
			if (failed.length > 0) {
				response += `Failed: ${failed
					.map((r) => `${formatDecision(r)} (${r.error ?? "unknown error"})`)
					.join(", ")}. `;
			}
			if (skippedDuplicates.length > 0) {
				response += `Skipped (already acted): ${skippedDuplicates.join(", ")}.`;
			}

			return response || "No positions were created";
		},
	});
}
