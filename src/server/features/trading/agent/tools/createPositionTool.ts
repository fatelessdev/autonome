/**
 * Create Position Tool
 * Opens one or more trading positions atomically
 */

import { tool } from "ai";
import { z } from "zod";
import { MARKETS } from "@/core/shared/markets/marketMetadata";
import { updateOrderCloseTrigger } from "@/server/db/ordersRepository.server";
import { ToolCallType } from "@/server/db/tradingRepository";
import { createToolCallMutation } from "@/server/db/tradingRepository.server";
import { calculateCooldownUntil } from "@/server/features/trading/execution/cooldown";
import { createPosition } from "@/server/features/trading/execution/createPosition";

import { decisionSchema, type NormalizedDecision } from "../schemas";
import { MAX_ACTIONS_PER_SYMBOL, type ToolContext } from "./types";

/**
 * Creates the createPosition tool with the given context
 */
/**
 * Check if a symbol is on cooldown for direction change.
 * Checks both open positions AND recently closed positions.
 * Returns null if allowed, or an error message if blocked.
 */
function checkCooldown(
	symbol: string,
	requestedSide: string,
	openPositionBySymbol: Map<string, ToolContext["openPositions"][number]>,
	closedPositionCooldowns: ToolContext["closedPositionCooldowns"],
	nowMs: number,
): string | null {
	const upperSymbol = symbol.toUpperCase();

	// Check open positions first
	const existingPosition = openPositionBySymbol.get(upperSymbol);

	if (existingPosition) {
		// Same direction = adding to position, no cooldown check needed
		const existingSide = existingPosition.side; // "LONG" or "SHORT"
		if (existingSide === requestedSide) return null;

		// Direction change requested - check cooldown
		const cooldownUntil = existingPosition.exitPlan?.cooldownUntil;
		if (cooldownUntil) {
			const cooldownTime = new Date(cooldownUntil);

			if (nowMs < cooldownTime.getTime()) {
				const remainingMs = cooldownTime.getTime() - nowMs;
				const remainingMins = Math.ceil(remainingMs / 60000);
				return `${symbol} direction change blocked: cooldown active for ${remainingMins} more minute(s) (until ${cooldownTime.toISOString()})`;
			}
		}
		return null;
	}

	// Check recently closed positions (for flip-after-close scenarios)
	const closedCooldown = closedPositionCooldowns.get(upperSymbol);
	if (closedCooldown) {
		// Same direction as closed position = allowed (re-entering same direction)
		if (closedCooldown.side === requestedSide) return null;

		// Opposite direction = check cooldown
		const cooldownTime = new Date(closedCooldown.cooldownUntil);

		if (nowMs < cooldownTime.getTime()) {
			const remainingMs = cooldownTime.getTime() - nowMs;
			const remainingMins = Math.ceil(remainingMs / 60000);
			return `${symbol} direction flip blocked: recently closed ${closedCooldown.side}, cooldown active for ${remainingMins} more minute(s) (until ${cooldownTime.toISOString()})`;
		}
	}

	return null;
}

export function createPositionTool(ctx: ToolContext) {
	return tool({
		description: "Open one or more positions atomically",
		inputSchema: z.object({
			decisions: z.array(decisionSchema),
		}),
		execute: async ({ decisions }) => {
			const nowMs = Date.now();
			const openPositionBySymbol = new Map<
				string,
				ToolContext["openPositions"][number]
			>();
			for (const position of ctx.openPositions) {
				if (!position.symbol) {
					throw new Error("Encountered open position with missing symbol");
				}
				openPositionBySymbol.set(position.symbol.toUpperCase(), position);
			}

			// decisions is Zod-validated: symbol is enum key, side is "LONG"|"SHORT"|"HOLD", quantity is positive number
			const modern = decisions.map((item) => ({
				symbol: item.symbol.toUpperCase(),
				side: item.side,
				quantity: item.quantity,
				profitTarget: item.profit_target ?? null,
				stopLoss: item.stop_loss ?? null,
				invalidationCondition: item.invalidation_condition ?? null,
				invalidationPrice: item.invalidation_price ?? null,
				timeExit: item.time_exit ?? null,
				cooldownUntil: calculateCooldownUntil(item.cooldown_minutes),
				confidence: item.confidence ?? null,
			}));

			const normalized: NormalizedDecision[] = [];
			const seenSymbols = new Set<string>();
			const skippedDuplicates: string[] = [];
			const skippedLimitReached: string[] = [];
			const skippedCooldown: string[] = [];

			for (const entry of [...modern]) {
				const symbol = entry.symbol;
				if (seenSymbols.has(symbol)) {
					skippedDuplicates.push(symbol);
					continue;
				}
				seenSymbols.add(symbol);

				// Check if already acted on this symbol this session (duplicate in same invocation)
				if (ctx.actedSymbols.has(symbol)) {
					skippedDuplicates.push(symbol);
					continue;
				}

				const currentCount = ctx.symbolActionCounts.get(symbol) ?? 0;
				if (currentCount >= MAX_ACTIONS_PER_SYMBOL) {
					skippedLimitReached.push(symbol);
					continue;
				}

				// Check cooldown for direction changes
				const cooldownError = checkCooldown(
					symbol,
					entry.side,
					openPositionBySymbol,
					ctx.closedPositionCooldowns,
					nowMs,
				);
				if (cooldownError) {
					skippedCooldown.push(cooldownError);
					continue;
				}

				// side and quantity are Zod-validated: side is enum("LONG"|"SHORT"|"HOLD"), quantity is number().positive()
				const validSide = entry.side;
				const quantity = entry.quantity;

				if (!(symbol in MARKETS)) {
					throw new Error(
						`Unsupported market symbol in createPosition tool: ${symbol}`,
					);
				}

				normalized.push({
					symbol,
					side: validSide,
					quantity,
					profitTarget: entry.profitTarget ?? null,
					stopLoss: entry.stopLoss ?? null,
					invalidationCondition: entry.invalidationCondition ?? null,
					invalidationPrice: entry.invalidationPrice ?? null,
					timeExit: entry.timeExit ?? null,
					cooldownUntil: entry.cooldownUntil ?? null,
					confidence: entry.confidence ?? null,
				});
			}

			// Return early if all symbols were duplicates or hit limits
			if (normalized.length === 0) {
				const messages: string[] = [];
				if (skippedDuplicates.length > 0) {
					messages.push(
						`Already acted on ${skippedDuplicates.join(", ")} this invocation`,
					);
				}
				if (skippedLimitReached.length > 0) {
					messages.push(
						`Session limit (${MAX_ACTIONS_PER_SYMBOL}) reached for ${skippedLimitReached.join(", ")}`,
					);
				}
				if (skippedCooldown.length > 0) {
					messages.push(skippedCooldown.join("; "));
				}
				return messages.length > 0
					? `${messages.join(". ")}. Call 'holding' if done.`
					: "No valid positions to create.";
			}

			const results = await createPosition(ctx.account, normalized);

			const successful = results.filter((r) => r.success);
			const failed = results.filter((r) => !r.success);

			// Mark successful symbols as acted and increment counts
			for (const result of successful) {
				ctx.actedSymbols.add(result.symbol);
				const current = ctx.symbolActionCounts.get(result.symbol) ?? 0;
				ctx.symbolActionCounts.set(result.symbol, current + 1);
			}

			// Detect close+reopen adjustments: if we just opened a symbol
			// that was closed earlier in this invocation, mark the close as
			// an "adjustment" so it doesn't count as a completed trade.
			for (const result of successful) {
				const closedSameSymbol = ctx.capturedClosedPositions.find(
					(p) =>
						p.symbol.toUpperCase() === result.symbol.toUpperCase() && p.orderId,
				);
				if (closedSameSymbol?.orderId) {
					await updateOrderCloseTrigger(closedSameSymbol.orderId, "adjustment");
				}
			}

			// Capture decisions for telemetry
			for (const decision of normalized) {
				ctx.capturedDecisions.push({
					symbol: decision.symbol,
					side: decision.side,
					quantity: decision.quantity,
					profitTarget: decision.profitTarget,
					stopLoss: decision.stopLoss,
					invalidationCondition: decision.invalidationCondition,
					invalidationPrice: decision.invalidationPrice,
					timeExit: decision.timeExit,
					cooldownUntil: decision.cooldownUntil,
					confidence: decision.confidence,
				});
			}

			// Capture execution results for telemetry
			for (const outcome of results) {
				if (!outcome.success && !outcome.error) {
					throw new Error(
						`createPosition returned failed outcome without error for ${outcome.symbol}`,
					);
				}

				ctx.capturedExecutionResults.push({
					symbol: outcome.symbol,
					side: outcome.side,
					quantity: outcome.quantity,
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
				pieces.push(`qty ${Math.abs(r.quantity).toPrecision(3)}`);
				return pieces.join(" ");
			};

			let response = "";
			if (successful.length > 0) {
				response += `Successfully processed: ${successful.map(formatDecision).join(", ")}. `;
			}
			if (failed.length > 0) {
				response += `Failed: ${failed
					.map((r) => {
						if (!r.error) {
							throw new Error(
								`createPosition returned failed outcome without error for ${r.symbol}`,
							);
						}
						return `${formatDecision(r)} (${r.error})`;
					})
					.join(", ")}. `;
			}
			if (skippedDuplicates.length > 0) {
				response += `Skipped (already acted): ${skippedDuplicates.join(", ")}. `;
			}
			if (skippedLimitReached.length > 0) {
				response += `Skipped (session limit): ${skippedLimitReached.join(", ")}.`;
			}
			// Surface trade size adjustments to the LLM
			const adjustments = results.filter((r) => r.adjustmentNote);
			if (adjustments.length > 0) {
				response += `Size adjustments: ${adjustments.map((r) => r.adjustmentNote).join(" | ")}`;
			}

			return response || "No positions were created";
		},
	});
}
