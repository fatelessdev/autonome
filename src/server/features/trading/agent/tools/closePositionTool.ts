/**
 * Close Position Tool
 * Closes one or more open trading positions
 */

import { tool } from "ai";
import { z } from "zod";

import { ToolCallType } from "@/server/db/tradingRepository";
import { createToolCallMutation } from "@/server/db/tradingRepository.server";
import { closePosition } from "@/server/features/trading/closePosition";

import { marketSymbols } from "../schemas";
import { MAX_ACTIONS_PER_SYMBOL, type ToolContext } from "./types";

/**
 * Creates the closePosition tool with the given context
 */
export function closePositionTool(ctx: ToolContext) {
	return tool({
		description: "Close one or more open positions",
		inputSchema: z.object({
			symbols: z
				.array(z.enum(marketSymbols as unknown as [string, ...string[]]))
				.describe("Symbols to close"),
		}),
		execute: async ({ symbols }) => {
			// Filter out already-acted symbols
			// TODO: Re-enable session limit filtering later
			const skippedDuplicates: string[] = [];
			const skippedLimitReached: string[] = [];
			const symbolsToClose = symbols.filter((s) => {
				const upper = s.toUpperCase();
				if (ctx.actedSymbols.has(upper)) {
					skippedDuplicates.push(upper);
					return false;
				}
				// const currentCount = ctx.symbolActionCounts.get(upper) ?? 0;
				// if (currentCount >= MAX_ACTIONS_PER_SYMBOL) {
				// 	skippedLimitReached.push(upper);
				// 	return false;
				// }
				return true;
			});

			if (symbolsToClose.length === 0) {
				const messages: string[] = [];
				if (skippedDuplicates.length > 0) {
					messages.push(`Already acted on ${skippedDuplicates.join(", ")} this invocation`);
				}
				if (skippedLimitReached.length > 0) {
					messages.push(`Session limit (${MAX_ACTIONS_PER_SYMBOL}) reached for ${skippedLimitReached.join(", ")}`);
				}
				return messages.length > 0
					? `${messages.join(". ")}. Call 'holding' if done.`
					: "No positions to close.";
			}

			const closedPositions = await closePosition(ctx.account, symbolsToClose);

			// Mark closed symbols as acted and increment counts
			for (const pos of closedPositions) {
				ctx.actedSymbols.add(pos.symbol);
				const current = ctx.symbolActionCounts.get(pos.symbol) ?? 0;
				ctx.symbolActionCounts.set(pos.symbol, current + 1);
			}

			// Record tool call in database
			await createToolCallMutation({
				invocationId: ctx.invocationId,
				type: ToolCallType.CLOSE_POSITION,
				metadata: JSON.stringify({ symbols: symbolsToClose, closedPositions }),
			});

			// Capture closed positions for telemetry
			for (const position of closedPositions) {
				ctx.capturedClosedPositions.push({
					symbol: position.symbol,
					side: position.side,
					quantity: position.quantity,
					entryPrice: position.entryPrice,
					exitPrice: position.exitPrice,
					netPnl: position.netPnl,
					realizedPnl: position.realizedPnl,
					unrealizedPnl: position.unrealizedPnl,
					closedAt: position.closedAt ?? null,
				});
			}

			let response =
				closedPositions.length > 0
					? `Closed: ${closedPositions.map((p) => `${p.symbol} (${p.side})`).join(", ")}.`
					: "No positions were closed.";

			if (skippedDuplicates.length > 0) {
				response += ` Skipped (already acted): ${skippedDuplicates.join(", ")}.`;
			}
			if (skippedLimitReached.length > 0) {
				response += ` Skipped (session limit): ${skippedLimitReached.join(", ")}.`;
			}

			return response;
		},
	});
}
