import "@/polyfill";

import { os } from "@orpc/server";
import * as Sentry from "@sentry/react";
import { z } from "zod";
import { parseSymbols } from "@/shared/formatting/numberFormat";
import {
	variantIdSchema,
	isValidVariantId,
	type VariantId,
} from "@/core/shared/variants";
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
				const result = await import(
					"@/server/features/trading/data/queries.server"
				).then((module) => module.fetchTrades({ variant: input.variant, limit: input.limit }));
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
				throw new Error("Failed to fetch trades");
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
				const result = await import(
					"@/server/features/trading/data/queries.server"
				).then((module) => module.fetchPositions({ variant: input.variant }));
				const positions = result.map((modelPos) => ({
					modelId: modelPos.modelId,
					modelName: modelPos.modelName,
					modelVariant: toVariant(modelPos.modelVariant),
					modelLogo: modelPos.modelLogo ?? undefined,
					positions: modelPos.positions.map((pos) => ({
						symbol: pos.symbol,
						side: (pos.sign === "SHORT" ? "short" : "long") as
							| "short"
							| "long",
						quantity: pos.quantity,
						entryPrice: pos.entryPrice,
						notional: Number.isFinite(Number(pos.notional))
							? Number(pos.notional)
							: undefined,
						currentPrice: pos.currentPrice ?? pos.markPrice ?? undefined,
						unrealizedPnl: Number.isFinite(Number(pos.unrealizedPnl))
							? Number(pos.unrealizedPnl)
							: undefined,
						exitPlan: pos.exitPlan
							? {
								target: pos.exitPlan.target ?? undefined,
								stop: pos.exitPlan.stop ?? undefined,
								invalidation: pos.exitPlan.invalidation
									? {
											enabled: true,
											message: pos.exitPlan.invalidation,
									  }
									: undefined,
							}
							: undefined,
						signal: pos.signal ?? undefined,
						leverage: pos.leverage ?? undefined,
						confidence: pos.confidence ?? undefined,
						lastDecisionAt: pos.lastDecisionAt ?? undefined,
						decisionStatus: pos.decisionStatus ?? undefined,
					})),
					totalUnrealizedPnl: modelPos.totalUnrealizedPnl,
				}));
				return { positions };
			} catch (error) {
				Sentry.captureException(error);
				throw new Error("Failed to fetch positions");
			}
		});
	});

// ==================== Crypto Prices ====================

export const getCryptoPrices = os
	.input(CryptoPricesInputSchema)
	.output(CryptoPricesResponseSchema)
	.handler(async ({ input }) => {
		return Sentry.startSpan({ name: "getCryptoPrices" }, async () => {
			const symbols = input.symbols || [];
			const normalizedSymbols = parseSymbols(symbols.join(","));

			try {
				const result = await import(
					"@/server/features/trading/data/queries.server"
				).then((module) => module.fetchCryptoPrices(normalizedSymbols));
				const prices = result
					.filter((price) => price.symbol)
					.map((price) => ({
						symbol: price.symbol,
						price: price.price ?? 0,
						message: undefined as string | undefined,
					}));
				return { prices };
			} catch (error) {
				Sentry.captureException(error);
				return { prices: [] };
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
				const result = await import(
					"@/server/features/trading/data/queries.server"
				).then((module) =>
					module.fetchPortfolioHistory({
						variant: input.variant,
						startDate: input.startDate ? new Date(input.startDate) : undefined,
						endDate: input.endDate ? new Date(input.endDate) : undefined,
						maxPoints: input.maxPoints,
					}),
				);
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

