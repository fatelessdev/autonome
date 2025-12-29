import "@/polyfill";

import { os } from "@orpc/server";
import * as Sentry from "@sentry/react";
import { z } from "zod";
import { parseSymbols } from "@/shared/formatting/numberFormat";
import {
	CryptoPricesInputSchema,
	CryptoPricesResponseSchema,
	PortfolioHistoryResponseSchema,
	PositionsResponseSchema,
	TradesResponseSchema,
} from "../schema";

// ==================== Internal Types ====================

type Variant = "Situational" | "Minimal" | "Guardian" | "Max";

// These mirror the server-side types to avoid importing from server module
interface TradeRecord {
	id: string;
	modelId: string;
	modelName: string;
	modelRouterName: string | null;
	modelVariant: string;
	symbol: string;
	side: string;
	quantity: number | null;
	entryPrice: number | null;
	exitPrice: number | null;
	netPnl: number | null;
	openedAt: string | null;
	closedAt: string;
	holdingTime: string | null;
	timestamp: string;
}

interface PositionRecord {
	symbol: string;
	position: string;
	sign: string;
	side: string;
	quantity: number;
	entryPrice: number;
	markPrice: number | null;
	currentPrice: number | null;
	notional: string;
	unrealizedPnl: string;
	realizedPnl: string;
	liquidationPrice: string;
	leverage: number | null;
	confidence: number | null;
	signal: string;
	exitPlan: {
		stop: number | null;
		target: number | null;
		invalidation: string | null;
		confidence?: number | null;
	} | null;
	lastDecisionAt: string | null;
	decisionStatus: string;
}

interface ModelPositionsRecord {
	modelId: string;
	modelName: string;
	modelLogo: string | null;
	modelVariant: string;
	positions: PositionRecord[];
	totalUnrealizedPnl: number;
	availableCash: number;
}

interface CryptoPriceRecord {
	symbol: string;
	price: number | null;
}

interface PortfolioHistoryEntry {
	id: string;
	modelId: string;
	netPortfolio: string;
	createdAt: string;
	updatedAt: string;
	model: {
		name: string;
		variant: string | undefined;
		openRouterModelName: string;
	};
}

// Helper to safely cast variant
function toVariant(v: string | undefined): Variant | undefined {
	const variants: Variant[] = ["Situational", "Minimal", "Guardian", "Max"];
	return variants.includes(v as Variant) ? (v as Variant) : undefined;
}

// ==================== Trades ====================

const TradesInputSchema = z.object({
	variant: z.enum(["Situational", "Minimal", "Guardian", "Max"]).optional(),
	limit: z.number().int().min(1).max(500).optional(),
});

export const getTrades = os
	.input(TradesInputSchema)
	.output(TradesResponseSchema)
	.handler(async ({ input }) => {
		return Sentry.startSpan({ name: "getTrades" }, async () => {
			try {
				const result: TradeRecord[] = await import(
					"@/server/features/trading/queries.server"
				).then((module) => module.fetchTrades({ variant: input.variant, limit: input.limit }));
				// Transform the result to match the expected schema
				const trades = (result || []).map((trade) => ({
					id: trade.id || "",
					modelId: trade.modelId || "",
					modelName: trade.modelName || "",
					modelVariant: toVariant(trade.modelVariant),
					modelRouterName: trade.modelRouterName || undefined,
					modelKey: trade.modelRouterName || trade.modelId || "",
					side: (
						trade.side &&
						typeof trade.side === "string" &&
						trade.side.toLowerCase() === "short"
							? "short"
							: "long"
					) as "short" | "long",
					symbol: trade.symbol || "",
					entryPrice:
						typeof trade.entryPrice === "number" ? trade.entryPrice : 0,
					exitPrice: typeof trade.exitPrice === "number" ? trade.exitPrice : 0,
					quantity: typeof trade.quantity === "number" ? trade.quantity : 0,
					netPnl: typeof trade.netPnl === "number" ? trade.netPnl : 0,
					openedAt:
						typeof trade.openedAt === "string"
							? trade.openedAt
							: new Date().toISOString(),
					closedAt:
						typeof trade.closedAt === "string"
							? trade.closedAt
							: new Date().toISOString(),
					holdingTime:
						typeof trade.holdingTime === "string"
							? trade.holdingTime
							: undefined,
					timestamp:
						typeof trade.timestamp === "string"
							? trade.timestamp
							: new Date().toISOString(),
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
	variant: z.enum(["Situational", "Minimal", "Guardian", "Max"]).optional(),
});

export const getPositions = os
	.input(PositionsInputSchema)
	.output(PositionsResponseSchema)
	.handler(async ({ input }) => {
		return Sentry.startSpan({ name: "getPositions" }, async () => {
			try {
				const result = await import(
					"@/server/features/trading/queries.server"
				).then((module) => module.fetchPositions({ variant: input.variant }));
				// Transform the result to match the expected schema
				const positions = (result || []).map((modelPos: ModelPositionsRecord) => ({
					modelId: modelPos.modelId || "",
					modelName: modelPos.modelName || "",
					modelVariant: toVariant(modelPos.modelVariant),
					modelLogo:
						typeof modelPos.modelLogo === "string"
							? modelPos.modelLogo
							: undefined,
					positions: Array.isArray(modelPos.positions)
						? modelPos.positions.map((pos: PositionRecord) => ({
								symbol: typeof pos.symbol === "string" ? pos.symbol : "",
								side: (
									pos.sign &&
									typeof pos.sign === "string" &&
									pos.sign.toUpperCase() === "SHORT"
										? "short"
										: "long"
								) as "short" | "long",
								quantity: typeof pos.quantity === "number" ? pos.quantity : 0,
								entryPrice:
									typeof pos.entryPrice === "number" ? pos.entryPrice : 0,
								currentPrice:
									typeof pos.currentPrice === "number"
										? pos.currentPrice
									: typeof pos.markPrice === "number"
										? pos.markPrice
										: undefined,
								unrealizedPnl:
									typeof pos.unrealizedPnl === "number"
										? pos.unrealizedPnl
										: typeof pos.unrealizedPnl === "string"
											? parseFloat(pos.unrealizedPnl)
											: undefined,
								exitPlan:
									pos.exitPlan && typeof pos.exitPlan === "object"
										? {
												target:
													typeof pos.exitPlan.target === "number"
														? pos.exitPlan.target
														: undefined,
												stop:
													typeof pos.exitPlan.stop === "number"
														? pos.exitPlan.stop
														: undefined,
												invalidation:
													pos.exitPlan.invalidation &&
													typeof pos.exitPlan.invalidation === "string"
														? {
																enabled: true,
																message: pos.exitPlan.invalidation,
															}
														: undefined,
											}
										: undefined,
								signal: typeof pos.signal === "string" ? pos.signal : undefined,
								leverage:
									typeof pos.leverage === "number" ? pos.leverage : undefined,
								confidence:
									typeof pos.confidence === "number"
										? pos.confidence
										: undefined,
								lastDecisionAt:
									typeof pos.lastDecisionAt === "string"
										? pos.lastDecisionAt
										: undefined,
								decisionStatus:
									typeof pos.decisionStatus === "string"
										? pos.decisionStatus
										: undefined,
							}))
						: [],
					totalUnrealizedPnl:
						typeof modelPos.totalUnrealizedPnl === "number"
							? modelPos.totalUnrealizedPnl
							: undefined,
					availableCash:
						typeof modelPos.availableCash === "number"
							? modelPos.availableCash
							: undefined,
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
				const result: CryptoPriceRecord[] = await import(
					"@/server/features/trading/queries.server"
				).then((module) => module.fetchCryptoPrices(normalizedSymbols));
				// Transform the result to match the expected schema
				const prices = (result || [])
					.map((price) => ({
						symbol: typeof price.symbol === "string" ? price.symbol : "",
						price: typeof price.price === "number" ? price.price : 0,
						message: undefined as string | undefined,
					}))
					.filter(
						(price) => typeof price.symbol === "string" && price.symbol,
					);
				return { prices };
			} catch (error) {
				Sentry.captureException(error);
				return { prices: [] };
			}
		});
	});

// ==================== Portfolio History ====================

const PortfolioHistoryInputSchema = z.object({
	variant: z.enum(["Situational", "Minimal", "Guardian", "Max"]).optional(),
	startDate: z.string().datetime().optional(),
	endDate: z.string().datetime().optional(),
	maxPoints: z.number().int().min(100).max(10000).optional(),
});

export const getPortfolioHistory = os
	.input(PortfolioHistoryInputSchema)
	.output(PortfolioHistoryResponseSchema)
	.handler(async ({ input }) => {
		return Sentry.startSpan({ name: "getPortfolioHistory" }, async () => {
			try {
				const result: PortfolioHistoryEntry[] = await import(
					"@/server/features/trading/queries.server"
				).then((module) =>
					module.fetchPortfolioHistory({
						variant: input.variant,
						startDate: input.startDate ? new Date(input.startDate) : undefined,
						endDate: input.endDate ? new Date(input.endDate) : undefined,
						maxPoints: input.maxPoints,
					}),
				);
				// Transform the result to match the expected schema
				const history = (result || []).map((entry) => ({
					id: typeof entry.id === "string" ? entry.id : "",
					modelId: typeof entry.modelId === "string" ? entry.modelId : "",
					netPortfolio:
						typeof entry.netPortfolio === "string" ? entry.netPortfolio : "",
					createdAt:
						typeof entry.createdAt === "string"
							? entry.createdAt
							: new Date().toISOString(),
					updatedAt:
						typeof entry.updatedAt === "string"
							? entry.updatedAt
							: new Date().toISOString(),
					model:
						entry.model && typeof entry.model === "object"
							? {
									name:
										typeof entry.model.name === "string"
											? entry.model.name
											: "",
									variant:
										typeof entry.model.variant === "string" &&
										[
											"Situational",
											"Minimal",
											"Guardian",
											"Max",
										].includes(entry.model.variant)
											? (entry.model.variant as "Situational" | "Minimal" | "Guardian" | "Max")
											: undefined,
									openRouterModelName:
										typeof entry.model.openRouterModelName === "string"
											? entry.model.openRouterModelName
											: undefined,
								}
							: undefined,
				}));
				return history;
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
