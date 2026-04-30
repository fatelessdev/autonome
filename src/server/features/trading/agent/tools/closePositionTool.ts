/**
 * Close Position Tool
 * Closes one or more open trading positions
 */

import { tool } from "ai";
import { z } from "zod";

import { ToolCallType } from "@/server/db/tradingRepository";
import { createToolCallMutation } from "@/server/db/tradingRepository.server";
import { closePosition } from "@/server/features/trading/execution/closePosition";

import { marketSymbols } from "../schemas";
import type { ToolContext } from "./types";

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
			const skippedDuplicates: string[] = [];
			const symbolsToClose = symbols.filter((s) => {
				const upper = s.toUpperCase();
				if (ctx.actedSymbols.has(upper)) {
					skippedDuplicates.push(upper);
					return false;
				}
				return true;
			});

			// Before closing, capture cooldown info from open positions
			for (const symbol of symbolsToClose) {
				const upper = symbol.toUpperCase();
				const position = ctx.openPositions.find((p) => {
					if (!p.symbol) {
						throw new Error("Encountered open position with missing symbol");
					}
					return p.symbol.toUpperCase() === upper;
				});
				if (position?.exitPlan?.cooldownUntil && position.side) {
					ctx.closedPositionCooldowns.set(upper, {
						side: position.side as "LONG" | "SHORT",
						cooldownUntil: position.exitPlan.cooldownUntil,
					});
				}
			}

			if (symbolsToClose.length === 0) {
				const messages: string[] = [];
				if (skippedDuplicates.length > 0) {
					messages.push(
						`Already acted on ${skippedDuplicates.join(", ")} this invocation`,
					);
				}
				return messages.length > 0
					? `${messages.join(". ")}. Call 'holding' if done.`
					: "No positions to close.";
			}

			const closedPositions = await closePosition(ctx.account, symbolsToClose);

			// Mark closed symbols as acted
			for (const pos of closedPositions) {
				ctx.actedSymbols.add(pos.symbol);
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
					orderId: position.orderId,
				});
			}

			let response =
				closedPositions.length > 0
					? `Closed: ${closedPositions.map((p) => `${p.symbol} (${p.side})`).join(", ")}.`
					: "No positions were closed.";

			if (skippedDuplicates.length > 0) {
				response += ` Skipped (already acted): ${skippedDuplicates.join(", ")}.`;
			}

			return response;
		},
	});
}
