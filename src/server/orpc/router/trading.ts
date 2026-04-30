import "@/polyfill";

import { os } from "@orpc/server";
import * as Sentry from "@sentry/react";
import { z } from "zod";
import { parseSymbols } from "@/core/shared/formatting/numberFormat";
import {
	isValidVariantId,
	type VariantId,
	variantIdSchema,
} from "@/core/shared/variants";
import {
	fetchCryptoPrices,
	fetchPortfolioHistory,
	fetchPositions,
	fetchTrades,
} from "@/server/features/trading/data/tradingQueries.server";
import {
	CryptoPricesInputSchema,
	CryptoPricesResponseSchema,
	PortfolioHistoryResponseSchema,
	PositionsResponseSchema,
	TradesResponseSchema,
} from "../schema";

// Helper to safely cast variant using shared utility
function toVariant(v: string | undefined): VariantId | undefined {
	return isValidVariantId(v) ? v : undefined;
}

// ==================== Trades ====================

const TradesInputSchema = z.object({
	variant: variantIdSchema.optional(),
	limit: z.number().int().min(1).max(500).optional(),
});

export const getTrades = os
	.input(TradesInputSchema)
	.output(TradesResponseSchema)
	.handler(async ({ input }) => {
		return Sentry.startSpan({ name: "getTrades" }, async () => {
			try {
				const result = await fetchTrades({
					variant: input.variant,
					limit: input.limit,
				});
				const trades = result.map((trade) => ({
					id: trade.id,
					modelId: trade.modelId,
					modelName: trade.modelName,
					modelVariant: toVariant(trade.modelVariant),
					modelRouterName: trade.modelRouterName ?? undefined,
					modelKey: trade.modelRouterName ?? trade.modelId,
					side: (trade.side.toUpperCase() === "SHORT" ? "short" : "long") as
						| "short"
						| "long",
					symbol: trade.symbol,
					entryPrice: trade.entryPrice ?? 0,
					exitPrice: trade.exitPrice ?? 0,
					quantity: trade.quantity ?? 0,
					netPnl: trade.netPnl ?? 0,
					openedAt: trade.openedAt ?? trade.closedAt,
					closedAt: trade.closedAt,
					holdingTime: trade.holdingTime ?? undefined,
					timestamp: trade.timestamp,
				}));
				return { trades };
			} catch (error) {
				Sentry.captureException(error);
				throw new Error(
					error instanceof Error
						? `Failed to fetch trades: ${error.message}`
						: "Failed to fetch trades",
				);
			}
		});
	});

// ==================== Positions ====================

const PositionsInputSchema = z.object({
	variant: variantIdSchema.optional(),
});

export const getPositions = os
	.input(PositionsInputSchema)
	.output(PositionsResponseSchema)
	.handler(async ({ input }) => {
		return Sentry.startSpan({ name: "getPositions" }, async () => {
			try {
				const result = await fetchPositions({ variant: input.variant });
				const positions = result.map((modelPos) => ({
					modelId: modelPos.modelId,
					modelName: modelPos.modelName,
					modelVariant: toVariant(modelPos.modelVariant),
					modelLogo: modelPos.modelLogo ?? undefined,
					positions: modelPos.positions.map((pos) => ({
						symbol: pos.symbol,
						side: (pos.side === "SHORT" ? "short" : "long") as "short" | "long",
						quantity: pos.quantity,
						entryPrice: pos.entryPrice,
						notional: Number.isFinite(Number(pos.notional))
							? Number(pos.notional)
							: undefined,
						currentPrice: pos.currentPrice ?? pos.markPrice ?? undefined,
						unrealizedPnl: Number.isFinite(pos.unrealizedPnl)
							? pos.unrealizedPnl
							: undefined,
						exitPlan: pos.exitPlan
							? {
									target: pos.exitPlan.target ?? null,
									stop: pos.exitPlan.stop ?? null,
									invalidation: pos.exitPlan.invalidation ?? null,
								}
							: undefined,
						confidence: pos.confidence ?? undefined,
						lastDecisionAt: pos.lastDecisionAt ?? undefined,
						decisionStatus: pos.decisionStatus ?? undefined,
					})),
					totalUnrealizedPnl: modelPos.totalUnrealizedPnl,
				}));
				return { positions };
			} catch (error) {
				Sentry.captureException(error);
				throw new Error(
					error instanceof Error
						? `Failed to fetch positions: ${error.message}`
						: "Failed to fetch positions",
				);
			}
		});
	});

// ==================== Crypto Prices ====================

export const getCryptoPrices = os
	.input(CryptoPricesInputSchema)
	.output(CryptoPricesResponseSchema)
	.handler(async ({ input }) => {
		return Sentry.startSpan({ name: "getCryptoPrices" }, async () => {
			try {
				const symbols = input.symbols ?? [];
				const normalizedSymbols = parseSymbols(symbols.join(","));

				const result = await fetchCryptoPrices(normalizedSymbols);
				const prices = result.map((price) => {
					if (!price.symbol) {
						throw new Error("Received crypto price with missing symbol");
					}
					if (price.price == null || !Number.isFinite(price.price)) {
						throw new Error(
							`Received invalid crypto price for ${price.symbol}`,
						);
					}

					return {
						symbol: price.symbol,
						price: price.price,
						message: undefined as string | undefined,
					};
				});

				return { prices };
			} catch (error) {
				Sentry.captureException(error);
				throw new Error(
					error instanceof Error
						? `Failed to fetch crypto prices: ${error.message}`
						: "Failed to fetch crypto prices",
				);
			}
		});
	});

// ==================== Portfolio History ====================

const PortfolioHistoryInputSchema = z.object({
	variant: variantIdSchema.optional(),
	startDate: z.string().datetime().optional(),
	endDate: z.string().datetime().optional(),
	// Aggregate mode (no variant) needs more points since data spans all model-variant combinations
	maxPoints: z.number().int().min(100).max(15000).optional(),
});

export const getPortfolioHistory = os
	.input(PortfolioHistoryInputSchema)
	.output(PortfolioHistoryResponseSchema)
	.handler(async ({ input }) => {
		return Sentry.startSpan({ name: "getPortfolioHistory" }, async () => {
			try {
				const result = await fetchPortfolioHistory({
					variant: input.variant,
					startDate: input.startDate ? new Date(input.startDate) : undefined,
					endDate: input.endDate ? new Date(input.endDate) : undefined,
					maxPoints: input.maxPoints,
				});
				const history = result.history.map((entry) => ({
					id: entry.id,
					modelId: entry.modelId,
					netPortfolio: entry.netPortfolio,
					createdAt: entry.createdAt,
					updatedAt: entry.updatedAt,
					model: entry.model
						? {
								name: entry.model.name,
								variant: toVariant(entry.model.variant),
								openRouterModelName:
									entry.model.openRouterModelName ?? undefined,
							}
						: undefined,
				}));
				return { history, resolution: result.resolution };
			} catch (error) {
				Sentry.captureException(error);
				throw new Error(
					error instanceof Error
						? error.message
						: "Unknown error while fetching portfolio history",
				);
			}
		});
	});
