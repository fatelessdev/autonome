import "@/polyfill";

import { os } from "@orpc/server";
import * as Sentry from "@sentry/react";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { invocations, models, ToolCallType, toolCalls } from "@/db/schema";
import { DEFAULT_SIMULATOR_OPTIONS, IS_SIMULATION_ENABLED } from "@/env";
import { ExchangeSimulator } from "@/server/features/simulator/exchangeSimulator";
import type { OrderSide } from "@/server/features/simulator/types";
import { normalizeNumber } from "@/shared/formatting/numberFormat";
import { getArray, safeJsonParse } from "@/utils/json";

// ==================== Schema Definitions ====================

const OrderBookLevelSchema = z.object({
	price: z.number(),
	quantity: z.number(),
});

const OrderBookSnapshotSchema = z.object({
	symbol: z.string(),
	bids: z.array(OrderBookLevelSchema),
	asks: z.array(OrderBookLevelSchema),
	timestamp: z.string(),
});

const AccountPositionSchema = z.object({
	symbol: z.string(),
	side: z.enum(["LONG", "SHORT"]),
	quantity: z.number(),
	avgEntryPrice: z.number(),
	realizedPnl: z.number(),
	unrealizedPnl: z.number(),
	markPrice: z.number(),
	margin: z.number(),
	notional: z.number(),
	leverage: z.number().nullable(),
	exitPlan: z
		.object({
			stop: z.number().nullable(),
			target: z.number().nullable(),
			invalidation: z.string().nullable(),
		})
		.nullable(),
});

const AccountSnapshotSchema = z.object({
	cashBalance: z.number(),
	availableCash: z.number(),
	borrowedBalance: z.number(),
	equity: z.number(),
	marginBalance: z.number(),
	quoteCurrency: z.string(),
	positions: z.array(AccountPositionSchema),
	totalRealizedPnl: z.number(),
	totalUnrealizedPnl: z.number(),
	totalFundingPnl: z.number(),
});

const PlaceOrderInputSchema = z.object({
	accountId: z.string().optional(),
	symbol: z.string(),
	quantity: z.number().positive(),
	side: z.enum(["buy", "sell", "long", "short"]),
	type: z.enum(["market", "limit"]).optional(),
	limitPrice: z.number().optional(),
	price: z.number().optional(),
	leverage: z.number().positive().optional(),
	confidence: z.number().optional(),
});

const PlaceOrderResponseSchema = z.object({
	order: z.any(),
});

const GetAccountInputSchema = z.object({
	accountId: z.string().optional(),
});

const GetAccountResponseSchema = z.object({
	account: AccountSnapshotSchema,
});

const ResetAccountInputSchema = z.object({
	accountId: z.string().optional(),
});

const ResetAccountResponseSchema = z.object({
	account: AccountSnapshotSchema,
});

const GetOrderBookInputSchema = z.object({
	symbol: z.string(),
});

const GetOrderBookResponseSchema = z.object({
	orderBook: OrderBookSnapshotSchema,
});

const CompletedTradeSchema = z.object({
	id: z.string(),
	symbol: z.string(),
	side: z.string(),
	direction: z.string(),
	notional: z.number(),
	realizedPnl: z.number(),
	leverage: z.number().optional(),
	confidence: z.number().optional(),
	timestamp: z.string(),
});

const GetCompletedTradesInputSchema = z.object({
	accountId: z.string().optional(),
});

const GetCompletedTradesResponseSchema = z.object({
	trades: z.array(CompletedTradeSchema),
});

const TradeStatsSchema = z.object({
	tradeCount: z.number(),
	totalRealized: z.number(),
	expectancy: z.number().nullable(),
	averageLeverage: z.number().nullable(),
	medianLeverage: z.number().nullable(),
	maxLeverage: z.number().nullable(),
	leverageValues: z.array(z.number()),
	averageConfidence: z.number().nullable(),
	medianConfidence: z.number().nullable(),
	confidenceValues: z.array(z.number()),
});

const GetCompletedTradesFromDBInputSchema = z.object({
	modelId: z.string().optional(),
	limit: z.number().int().positive().optional(),
});

const CompletedTradeFromDBSchema = z.object({
	id: z.string(),
	modelId: z.string(),
	modelName: z.string().nullable(),
	symbol: z.string(),
	direction: z.enum(["LONG", "SHORT"]),
	notional: z.number().nullable(),
	realizedPnl: z.number().nullable(),
	leverage: z.number().nullable(),
	confidence: z.number().nullable(),
	closedAt: z.string().nullable(),
	invocationId: z.string(),
});

const GetCompletedTradesFromDBResponseSchema = z.object({
	trades: z.array(CompletedTradeFromDBSchema),
	stats: TradeStatsSchema,
});

// ==================== Helper Functions ====================

const normalizeAccountId = (
	value: string | undefined,
	fallback = "default",
) => {
	if (typeof value === "string") {
		const trimmed = value.trim();
		if (trimmed.length > 0) {
			return trimmed;
		}
	}
	return fallback;
};

async function ensureSimulator() {
	if (!IS_SIMULATION_ENABLED) {
		throw new Error("Simulation mode is disabled");
	}
	return ExchangeSimulator.bootstrap(DEFAULT_SIMULATOR_OPTIONS);
}

function normalizeSide(side: string): OrderSide {
	const lower = side.toLowerCase();
	if (lower === "buy" || lower === "long") {
		return "buy";
	}
	if (lower === "sell" || lower === "short") {
		return "sell";
	}
	throw new Error(`Unsupported order side: ${side}`);
}

function normalizeConfidence(value: unknown): number | null {
	const numeric = normalizeNumber(value);
	if (numeric == null || !Number.isFinite(numeric)) {
		return null;
	}
	if (numeric <= 0) {
		return null;
	}
	return numeric > 1 ? numeric / 100 : numeric;
}

function average(values: number[]): number | null {
	if (!values.length) {
		return null;
	}
	const sum = values.reduce((acc, curr) => acc + curr, 0);
	return sum / values.length;
}

function median(values: number[]): number | null {
	if (!values.length) {
		return null;
	}
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	if (sorted.length % 2 === 0) {
		return (sorted[mid - 1]! + sorted[mid]!) / 2;
	}
	return sorted[mid]!;
}

type CompletedTradeFromDB = z.infer<typeof CompletedTradeFromDBSchema>;

function buildStats(trades: CompletedTradeFromDB[]) {
	if (!trades.length) {
		return {
			tradeCount: 0,
			totalRealized: 0,
			expectancy: null,
			averageLeverage: null,
			medianLeverage: null,
			maxLeverage: null,
			leverageValues: [],
			averageConfidence: null,
			medianConfidence: null,
			confidenceValues: [],
		};
	}

	const realizedValues = trades
		.map((trade) => trade.realizedPnl)
		.filter(
			(value): value is number => value !== null && Number.isFinite(value),
		);

	const leverageValues = trades
		.map((trade) => trade.leverage)
		.filter(
			(value): value is number =>
				value !== null && Number.isFinite(value) && value > 0,
		);

	const confidenceValues = trades
		.map((trade) => trade.confidence)
		.filter(
			(value): value is number =>
				value !== null && Number.isFinite(value) && value > 0,
		);

	const totalRealized = realizedValues.reduce((acc, value) => acc + value, 0);
	const tradeCount = trades.length;

	return {
		tradeCount,
		totalRealized,
		expectancy: tradeCount > 0 ? totalRealized / tradeCount : null,
		averageLeverage: average(leverageValues),
		medianLeverage: median(leverageValues),
		maxLeverage: leverageValues.length ? Math.max(...leverageValues) : null,
		leverageValues,
		averageConfidence: average(confidenceValues),
		medianConfidence: median(confidenceValues),
		confidenceValues,
	};
}

function buildCreateIndex(
	toolCallsData: Array<{ metadata: string; createdAt: Date }>,
) {
	const index = new Map<
		string,
		{ leverage: number | null; confidence: number | null; createdAt: number }
	>();

	for (const call of toolCallsData) {
		const metadata = safeJsonParse<Record<string, unknown>>(call.metadata, {});
		const decisions = getArray<Record<string, unknown>>(metadata.decisions);
		const timestamp = call.createdAt.getTime();

		for (const decision of decisions) {
			const symbolRaw =
				typeof decision.symbol === "string" ? decision.symbol : null;
			if (!symbolRaw) {
				continue;
			}

			const leverage = normalizeNumber(decision.leverage);
			const confidence = normalizeConfidence(decision.confidence);
			const key = symbolRaw.toUpperCase();
			const existing = index.get(key);

			if (!existing || existing.createdAt <= timestamp) {
				index.set(key, {
					leverage: leverage && leverage > 0 ? leverage : null,
					confidence,
					createdAt: timestamp,
				});
			}
		}
	}

	return index;
}

// ==================== Simulator Procedures ====================

export const placeOrder = os
	.input(PlaceOrderInputSchema)
	.output(PlaceOrderResponseSchema)
	.handler(async ({ input }) => {
		return Sentry.startSpan({ name: "placeOrder" }, async () => {
			try {
				const simulator = await ensureSimulator();
				const accountId = normalizeAccountId(input.accountId, "default");
				const symbol = input.symbol.trim();
				const quantity = input.quantity;
				const side = normalizeSide(input.side);
				const orderType = input.type === "limit" ? "limit" : "market";
				const limitPrice = input.limitPrice ?? input.price;
				const leverage = input.leverage;
				const confidence = input.confidence ?? null;

				if (!symbol) {
					throw new Error("Symbol is required");
				}

				if (limitPrice !== undefined && !Number.isFinite(limitPrice)) {
					throw new Error("limitPrice must be a valid number");
				}

				const order = await simulator.placeOrder(
					{
						symbol,
						quantity,
						side,
						type: orderType,
						limitPrice,
						leverage,
						confidence,
					},
					accountId,
					{
						skipValidation: false,
					},
				);

				return { order };
			} catch (error) {
				console.error("Failed to place order", error);
				Sentry.captureException(error);
				throw new Error(
					error instanceof Error ? error.message : "Failed to place order",
				);
			}
		});
	});

export const getCompletedTradesFromDB = os
	.input(GetCompletedTradesFromDBInputSchema)
	.output(GetCompletedTradesFromDBResponseSchema)
	.handler(async ({ input }) => {
		return Sentry.startSpan({ name: "getCompletedTradesFromDB" }, async () => {
			const modelId = input.modelId;
			const limitParam = input.limit ?? 200;
			const take = Math.min(limitParam, 500);

			if (!modelId) {
				const empty: CompletedTradeFromDB[] = [];
				return { trades: empty, stats: buildStats(empty) };
			}

			const closeCalls = await db
				.select({
					id: toolCalls.id,
					metadata: toolCalls.metadata,
					createdAt: toolCalls.createdAt,
					invocationId: toolCalls.invocationId,
					modelId: invocations.modelId,
					modelName: models.name,
				})
				.from(toolCalls)
				.innerJoin(invocations, eq(toolCalls.invocationId, invocations.id))
				.innerJoin(models, eq(invocations.modelId, models.id))
				.where(
					and(
						eq(toolCalls.toolCallType, ToolCallType.CLOSE_POSITION),
						eq(invocations.modelId, modelId),
					),
				)
				.orderBy(desc(toolCalls.createdAt))
				.limit(take);

			const invocationIds = closeCalls.map((call) => call.invocationId);

			const createCalls = invocationIds.length
				? await db
						.select({
							invocationId: toolCalls.invocationId,
							metadata: toolCalls.metadata,
							createdAt: toolCalls.createdAt,
						})
						.from(toolCalls)
						.where(
							and(
								eq(toolCalls.toolCallType, ToolCallType.CREATE_POSITION),
								inArray(toolCalls.invocationId, invocationIds),
							),
						)
				: [];

			const createLookup = new Map<
				string,
				Array<{ metadata: string; createdAt: Date }>
			>();
			for (const call of createCalls) {
				const list = createLookup.get(call.invocationId) ?? [];
				list.push(call);
				createLookup.set(call.invocationId, list);
			}

			const trades: CompletedTradeFromDB[] = [];

			for (const call of closeCalls) {
				const metadata = safeJsonParse<Record<string, unknown>>(
					call.metadata,
					{},
				);
				const closedPositions = getArray<Record<string, unknown>>(
					metadata.closedPositions,
				);

				const createIndex = buildCreateIndex(
					createLookup.get(call.invocationId) ?? [],
				);

				closedPositions.forEach((position, index) => {
					const symbolRaw =
						typeof position.symbol === "string" ? position.symbol : null;
					if (!symbolRaw) {
						return;
					}

					const sideValue =
						typeof position.side === "string"
							? position.side.toUpperCase()
							: "LONG";
					const direction: "LONG" | "SHORT" =
						sideValue === "SHORT" ? "SHORT" : "LONG";

					const quantity = normalizeNumber(position.quantity);
					const exitPrice = normalizeNumber(
						position.exitPrice ?? position.markPrice ?? position.entryPrice,
					);
					const notional =
						quantity !== null && exitPrice !== null
							? Math.abs(quantity * exitPrice)
							: null;

					const realizedPnl = normalizeNumber(
						position.realizedPnl ?? position.netPnl ?? position.unrealizedPnl,
					);
					const closedAt =
						typeof position.closedAt === "string" ? position.closedAt : null;

					const createInfo = createIndex.get(symbolRaw.toUpperCase());
					const leverage = createInfo?.leverage ?? null;
					const confidence = createInfo?.confidence ?? null;

					trades.push({
						id: `${call.id}:${index}`,
						modelId: call.modelId,
						modelName: call.modelName ?? null,
						symbol: symbolRaw,
						direction,
						notional,
						realizedPnl,
						leverage,
						confidence,
						closedAt,
						invocationId: call.invocationId,
					});
				});
			}

			return {
				trades,
				stats: buildStats(trades),
			};
		});
	});

export const getAccount = os
	.input(GetAccountInputSchema)
	.output(GetAccountResponseSchema)
	.handler(async ({ input }) => {
		return Sentry.startSpan({ name: "getAccount" }, async () => {
			if (!IS_SIMULATION_ENABLED) {
				throw new Error("Simulation mode is disabled");
			}

			const accountId = normalizeAccountId(input.accountId, "default");
			const simulator = await ensureSimulator();
			const account = simulator.getAccountSnapshot(accountId);

			return { account };
		});
	});

export const resetAccount = os
	.input(ResetAccountInputSchema)
	.output(ResetAccountResponseSchema)
	.handler(async ({ input }) => {
		return Sentry.startSpan({ name: "resetAccount" }, async () => {
			if (!IS_SIMULATION_ENABLED) {
				throw new Error("Simulation mode is disabled");
			}

			const accountId = normalizeAccountId(input.accountId, "default");

			try {
				const simulator = await ensureSimulator();
				const account = await simulator.resetAccount(accountId);
				return { account };
			} catch (error) {
				console.error("Failed to reset account", error);
				Sentry.captureException(error);
				throw new Error(
					error instanceof Error ? error.message : "Failed to reset account",
				);
			}
		});
	});

export const getOrderBook = os
	.input(GetOrderBookInputSchema)
	.output(GetOrderBookResponseSchema)
	.handler(async ({ input }) => {
		return Sentry.startSpan({ name: "getOrderBook" }, async () => {
			if (!IS_SIMULATION_ENABLED) {
				throw new Error("Simulation mode is disabled");
			}

			const { symbol } = input;
			if (!symbol) {
				throw new Error("symbol parameter is required");
			}

			const simulator = await ensureSimulator();
			const orderBook = simulator.getOrderBook(symbol);

			if (!orderBook) {
				throw new Error(`Order book not found for symbol: ${symbol}`);
			}

			return {
				orderBook: {
					...orderBook,
					timestamp: new Date(orderBook.timestamp).toISOString(),
				},
			};
		});
	});

export const getCompletedTrades = os
	.input(GetCompletedTradesInputSchema)
	.output(GetCompletedTradesResponseSchema)
	.handler(async ({ input }) => {
		return Sentry.startSpan({ name: "getCompletedTrades" }, async () => {
			if (!IS_SIMULATION_ENABLED) {
				throw new Error("Simulation mode is disabled");
			}

			const accountId = normalizeAccountId(input.accountId, "default");
			const simulator = await ensureSimulator();

			// For now, return empty trades as the simulator doesn't track this
			// Use getCompletedTradesFromDB for actual trade history
			return { trades: [] };
		});
	});
