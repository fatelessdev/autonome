import { queryOptions } from "@tanstack/react-query";
import { and, asc, desc, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { invocations, models, toolCalls } from "@/db/schema";
import {
	BASE_URL,
	DEFAULT_SIMULATOR_OPTIONS,
	IS_SIMULATION_ENABLED,
} from "@/env";
import {
	CandlestickApi,
	IsomorphicFetchHttpLibrary,
	ServerConfiguration,
} from "@/lighter/generated/index";
import { ExchangeSimulator } from "@/server/features/simulator/exchangeSimulator";
import type { Account } from "@/server/features/trading/accounts";
import { refreshConversationEvents } from "@/server/features/trading/conversationsSnapshot.server";
import { emitPositionEvent } from "@/server/features/trading/events/positionEvents";
import { emitTradeEvent } from "@/server/features/trading/events/tradeEvents";
import { getPortfolio } from "@/server/features/trading/getPortfolio";
import { getOpenPositions } from "@/server/features/trading/openPositions";
import { buildDecisionIndex } from "@/server/features/trading/tradingDecisions";
import { formatIstTimestamp } from "@/shared/formatting/dateFormat";
import { normalizeNumber } from "@/shared/formatting/numberFormat";
import { MARKETS } from "@/shared/markets/marketMetadata";
import { getArray, safeJsonParse } from "@/utils/json";

// ==========================================
// CRYPTO PRICES
// ==========================================

const candlestickApi = new CandlestickApi({
	baseServer: new ServerConfiguration(BASE_URL, {}),
	httpApi: new IsomorphicFetchHttpLibrary(),
	middleware: [],
	authMethods: {},
});

const canonicalSymbol = (symbol: string | undefined | null) => {
	if (!symbol) return "";
	return symbol
		.toUpperCase()
		.replace(/[^A-Z0-9]/g, "")
		.replace(/USDT$/, "");
};

const formatDuration = (openedAt: Date, closedAt: Date) => {
	const diffMs = closedAt.getTime() - openedAt.getTime();
	if (diffMs <= 0) return "<1M";
	const totalMinutes = Math.floor(diffMs / 60000);
	const days = Math.floor(totalMinutes / (60 * 24));
	const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
	const minutes = totalMinutes % 60;

	const parts: string[] = [];
	if (days > 0) parts.push(`${days}D`);
	if (hours > 0) parts.push(`${hours}H`);
	parts.push(`${minutes}M`);
	return parts.join(" ");
};

type CreatePositionRecord = {
	createdAt: Date;
	symbol: string;
	modelId: string;
	side?: string;
	quantity: number | null;
};

const consumeLatestCreateRecord = (
	lookup: Map<string, CreatePositionRecord[]>,
	modelId: string,
	symbol: string,
	closedAt: Date,
) => {
	const key = `${modelId}|${symbol}`;
	const records = lookup.get(key);
	if (!records || records.length === 0) return null;

	for (let i = records.length - 1; i >= 0; i -= 1) {
		if (records[i].createdAt <= closedAt) {
			const [record] = records.splice(i, 1);
			return record;
		}
	}
	return null;
};

export async function fetchCryptoPrices(symbols: string[]) {
	const normalizedSymbols = symbols.map((symbol) => symbol.toUpperCase());
	if (IS_SIMULATION_ENABLED) {
		return getSimulatedPrices(normalizedSymbols);
	}

	try {
		const livePrices = await getLighterPrices(normalizedSymbols);
		const hasLivePrices = livePrices.some((entry) => entry.price != null);
		if (hasLivePrices) {
			return livePrices;
		}
		console.warn(
			`[crypto-prices] Live price feed returned no data for ${normalizedSymbols.join(",")}, falling back to simulator`,
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.warn(
			"[crypto-prices] Live price fetch failed, falling back to simulator",
			message,
		);
	}

	return getSimulatedPrices(normalizedSymbols);
}

async function getLighterPrices(symbols: string[]) {
	const now = Date.now();

	const results = await Promise.all(
		symbols.map(async (symbol) => {
			const market = MARKETS[symbol as keyof typeof MARKETS];
			if (!market) {
				return { symbol, price: null as number | null };
			}

			try {
				const candles = await candlestickApi.candlesticks(
					market.marketId,
					"1m",
					now - 1000 * 60 * 15,
					now,
					1,
					false,
				);
				const last = candles.candlesticks?.[candles.candlesticks.length - 1];
				const price = normalizeNumber(last?.close);
				return { symbol, price };
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				console.warn(
					`[crypto-prices] Failed to fetch market ${symbol}`,
					message,
				);
				return { symbol, price: null as number | null };
			}
		}),
	);

	return results;
}

async function getSimulatedPrices(symbols: string[]) {
	const simulator = await ExchangeSimulator.bootstrap(
		DEFAULT_SIMULATOR_OPTIONS,
	);

	return symbols.map((symbol) => {
		try {
			const snapshot = simulator.getOrderBook(symbol);
			const price =
				typeof snapshot?.midPrice === "number" &&
					Number.isFinite(snapshot.midPrice)
					? snapshot.midPrice
					: null;
			return { symbol, price };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.warn(
				`[crypto-prices] Simulator missing market ${symbol}`,
				message,
			);
			return { symbol, price: null as number | null };
		}
	});
}

/**
 * Fetch crypto prices for given symbols
 * Cache: 5 seconds (highly volatile data)
 */
export const cryptoPricesQuery = (symbols: string[]) => {
	const normalizedSymbols = symbols.map((s) => s.toUpperCase()).sort();
	return queryOptions({
		queryKey: ["crypto-prices", ...normalizedSymbols],
		queryFn: () => fetchCryptoPrices(symbols),
		staleTime: 5_000, // 5 seconds
		gcTime: 30_000, // 30 seconds
		refetchInterval: 10_000, // Auto-refresh every 10 seconds
	});
};

// ==========================================
// TRADES
// ==========================================

export async function fetchTrades() {
	const closeCalls = await db
		.select({
			id: toolCalls.id,
			metadata: toolCalls.metadata,
			createdAt: toolCalls.createdAt,
			modelId: invocations.modelId,
			modelName: models.name,
			modelRouterName: models.openRouterModelName,
		})
		.from(toolCalls)
		.innerJoin(invocations, eq(toolCalls.invocationId, invocations.id))
		.innerJoin(models, eq(invocations.modelId, models.id))
		.where(eq(toolCalls.toolCallType, "CLOSE_POSITION"))
		.orderBy(desc(toolCalls.createdAt))
		.limit(100);

	if (closeCalls.length === 0) {
		return [];
	}

	const modelIds = Array.from(new Set(closeCalls.map((call) => call.modelId)));

	const createCalls = await db
		.select({
			id: toolCalls.id,
			metadata: toolCalls.metadata,
			createdAt: toolCalls.createdAt,
			modelId: invocations.modelId,
			side: toolCalls.metadata,
		})
		.from(toolCalls)
		.innerJoin(invocations, eq(toolCalls.invocationId, invocations.id))
		.where(
			and(
				eq(toolCalls.toolCallType, "CREATE_POSITION"),
				inArray(invocations.modelId, modelIds),
			),
		)
		.orderBy(asc(toolCalls.createdAt));

	const createLookup = new Map<string, CreatePositionRecord[]>();

	for (const call of createCalls) {
		const metadata = safeJsonParse<Record<string, unknown>>(call.metadata, {});
		const positions = getArray<Record<string, unknown>>(metadata.positions);

		for (const position of positions) {
			const symbol = canonicalSymbol(
				typeof position.symbol === "string" ? position.symbol : undefined,
			);
			if (!symbol) continue;

			const record: CreatePositionRecord = {
				createdAt: call.createdAt,
				symbol,
				modelId: call.modelId,
				side: typeof position.side === "string" ? position.side : undefined,
				quantity: normalizeNumber(position.quantity),
			};

			const key = `${record.modelId}|${record.symbol}`;
			const existing = createLookup.get(key) ?? [];
			existing.push(record);
			createLookup.set(key, existing);
		}
	}

	const trades = closeCalls.flatMap((call) => {
		const metadata = safeJsonParse<Record<string, unknown>>(call.metadata, {});
		const closedPositions = getArray<Record<string, unknown>>(
			metadata.closedPositions,
		);
		const fallbackSymbols = getArray<unknown>(metadata.symbols);

		if (closedPositions.length === 0) {
			return [] as unknown[];
		}

		const closedAt = call.createdAt;
		const closingTrades = closedPositions.map((position, idx) => {
			const symbolCandidate =
				typeof position.symbol === "string"
					? position.symbol
					: typeof fallbackSymbols[idx] === "string"
						? (fallbackSymbols[idx] as string)
						: undefined;
			const symbol = canonicalSymbol(symbolCandidate);
			if (!symbol) {
				return null;
			}

			const createRecord = consumeLatestCreateRecord(
				createLookup,
				call.modelId,
				symbol,
				closedAt,
			);
			const entryPrice = normalizeNumber(
				position.entryPrice ?? position.markPrice,
			);
			const exitPrice = normalizeNumber(
				position.exitPrice ?? position.markPrice,
			);
			const quantity = normalizeNumber(
				position.quantity ?? createRecord?.quantity,
			);
			const entryNotional =
				position.entryNotional != null
					? normalizeNumber(position.entryNotional)
					: entryPrice != null && quantity != null
						? entryPrice * quantity
						: null;
			const exitNotional =
				position.exitNotional != null
					? normalizeNumber(position.exitNotional)
					: exitPrice != null && quantity != null
						? exitPrice * quantity
						: null;
			const pnl = normalizeNumber(
				position.netPnl ?? position.realizedPnl ?? position.unrealizedPnl,
			);
			const openedAt = createRecord?.createdAt ?? null;
			const holdingTime = openedAt ? formatDuration(openedAt, closedAt) : null;

			return {
				id: `${call.id}:${symbol}:${idx}`,
				modelId: call.modelId,
				modelName: call.modelName,
				modelRouterName: call.modelRouterName,
				symbol,
				side:
					typeof position.side === "string"
						? position.side.toUpperCase()
						: (createRecord?.side?.toUpperCase() ?? "LONG"),
				quantity,
				entryPrice,
				exitPrice,
				entryNotional,
				exitNotional,
				netPnl: pnl,
				openedAt: openedAt?.toISOString() ?? null,
				closedAt: closedAt.toISOString(),
				holdingTime,
				timestamp: formatIstTimestamp(closedAt),
			};
		});

		return closingTrades.filter((trade): trade is NonNullable<typeof trade> =>
			Boolean(trade),
		);
	});

	// Emit SSE event with trades data
	emitTradeEvent({
		type: "trades:updated",
		timestamp: new Date().toISOString(),
		data: trades as any,
	});

	return trades;
}

/**
 * Fetch all trades (closed positions)
 * Cache: 15 seconds (frequently updated)
 */
export const tradesQuery = () =>
	queryOptions({
		queryKey: ["trades"],
		queryFn: fetchTrades,
		staleTime: 15_000, // 15 seconds
		gcTime: 2 * 60_000, // 2 minutes
	});

// ==========================================
// POSITIONS
// ==========================================

export async function fetchPositions() {
	try {
		const dbModels = await db
			.select({
				id: models.id,
				name: models.name,
				modelLogo: models.openRouterModelName,
				lighterApiKey: models.lighterApiKey,
				accountIndex: models.accountIndex,
				invocationCount: models.invocationCount,
				totalMinutes: models.totalMinutes,
			})
			.from(models);

		const results = await Promise.all(
			dbModels.map(async (model) => {
				try {
					const account: Account = {
						apiKey: model.lighterApiKey,
						accountIndex: model.accountIndex,
						id: model.id,
						modelName: model.modelLogo,
						name: model.name,
						invocationCount: model.invocationCount,
						totalMinutes: model.totalMinutes,
					};

					const [positionsResult, toolCallsResult, portfolioResult] =
						await Promise.allSettled([
							getOpenPositions(
								model.lighterApiKey,
								model.accountIndex,
								model.id,
								{ fallbackToSimulator: true },
							),
							db
								.select({
									id: toolCalls.id,
									metadata: toolCalls.metadata,
									createdAt: toolCalls.createdAt,
									toolCallType: toolCalls.toolCallType,
								})
								.from(toolCalls)
								.innerJoin(
									invocations,
									eq(toolCalls.invocationId, invocations.id),
								)
								.where(
									and(
										eq(toolCalls.toolCallType, "CREATE_POSITION"),
										eq(invocations.modelId, model.id),
									),
								)
								.orderBy(desc(toolCalls.createdAt))
								.limit(100),
							getPortfolio(account, { fallbackToSimulator: true }),
						]);

					const rawPositions =
						positionsResult.status === "fulfilled" ? positionsResult.value : [];
					if (positionsResult.status === "rejected") {
						const reason =
							positionsResult.reason instanceof Error
								? positionsResult.reason.message
								: String(positionsResult.reason);
						console.error(`Error loading positions for ${model.id}: ${reason}`);
					}

					const toolCallsData =
						toolCallsResult.status === "fulfilled" ? toolCallsResult.value : [];
					if (toolCallsResult.status === "rejected") {
						const reason =
							toolCallsResult.reason instanceof Error
								? toolCallsResult.reason.message
								: String(toolCallsResult.reason);
						console.error(
							`Error loading tool calls for ${model.id}: ${reason}`,
						);
					}

					const portfolio =
						portfolioResult.status === "fulfilled"
							? portfolioResult.value
							: {
								totalValue: 0,
								availableCash: 0,
								total: "0.00",
								available: "0.00",
							};
					if (portfolioResult.status === "rejected") {
						const reason =
							portfolioResult.reason instanceof Error
								? portfolioResult.reason.message
								: String(portfolioResult.reason);
						console.error(`Error loading portfolio for ${model.id}: ${reason}`);
					}

					const decisionIndex = buildDecisionIndex(
						toolCallsData.map((toolCall) => ({
							id: toolCall.id,
							createdAt: toolCall.createdAt,
							toolCallType: toolCall.toolCallType,
							metadata: safeJsonParse(toolCall.metadata, null),
						})),
					);

					const enrichedPositions = rawPositions.map((position: any) => {
						const symbolKey =
							position.symbol?.toUpperCase?.() ?? position.symbol;
						const decision = symbolKey
							? decisionIndex.get(symbolKey)
							: undefined;

						const mergedExitPlan = {
							target:
								decision?.profitTarget ?? position.exitPlan?.target ?? null,
							stop: decision?.stopLoss ?? position.exitPlan?.stop ?? null,
							invalidation:
								decision?.invalidationCondition ??
								position.exitPlan?.invalidation ??
								null,
						};

						const exitPlan =
							mergedExitPlan.target == null &&
								mergedExitPlan.stop == null &&
								mergedExitPlan.invalidation == null
								? null
								: mergedExitPlan;

						const decisionStatus =
							decision?.status ??
							(decision?.result?.success === true
								? "FILLED"
								: decision?.result?.success === false
									? "REJECTED"
									: null);

						return {
							...position,
							signal: decision?.signal ?? position.sign,
							leverage: decision?.leverage ?? position.leverage,
							confidence: decision?.confidence ?? null,
							exitPlan,
							lastDecisionAt: decision?.createdAt?.toISOString?.() ?? null,
							decisionStatus,
						};
					});

					const totalUnrealizedPnl = rawPositions.reduce(
						(sum: number, p: any) => {
							const value = normalizeNumber(
								(p as unknown as Record<string, unknown>).unrealizedPnl,
							);
							return sum + (value ?? 0);
						},
						0,
					);

					return {
						modelId: model.id,
						modelName: model.name,
						modelLogo: model.modelLogo,
						positions: enrichedPositions,
						totalUnrealizedPnl,
						availableCash: portfolio.availableCash,
					};
				} catch (error) {
					console.error(`Error fetching positions for ${model.id}`, error);
					return {
						modelId: model.id,
						modelName: model.name,
						modelLogo: model.modelLogo,
						positions: [],
						totalUnrealizedPnl: 0,
						availableCash: 0,
					};
				}
			}),
		);

		// Emit SSE event with positions data
		emitPositionEvent({
			type: "positions:updated",
			timestamp: new Date().toISOString(),
			data: results,
		});

		return results;
	} catch (error) {
		console.error("Error in fetchPositions function", error);
		throw error;
	}
}

/**
 * Fetch all positions across all models
 * Cache: 15 seconds (frequently updated)
 */
export const positionsQuery = () =>
	queryOptions({
		queryKey: ["positions"],
		queryFn: fetchPositions,
		staleTime: 15_000, // 15 seconds
		gcTime: 2 * 60_000, // 2 minutes
		refetchInterval: 30_000, // Auto-refresh every 30 seconds
	});

// ==========================================
// PORTFOLIO HISTORY
// ==========================================

export async function fetchPortfolioHistory() {
	const entries = await db.query.portfolioSize.findMany({
		with: {
			model: {
				columns: {
					name: true,
					openRouterModelName: true,
				},
			},
		},
		orderBy: (row, { asc: ascHelper }) => ascHelper(row.createdAt),
	});

	return entries.map((entry) => ({
		id: entry.id,
		modelId: entry.modelId,
		netPortfolio: entry.netPortfolio,
		createdAt: entry.createdAt.toISOString(),
		updatedAt: entry.updatedAt.toISOString(),
		model: {
			name: entry.model?.name ?? "Unknown Model",
			openRouterModelName: entry.model?.openRouterModelName ?? "unknown-model",
		},
	}));
}

/**
 * Fetch portfolio history for all models
 * Cache: 1 minute (updated every minute via scheduler)
 */
export const portfolioHistoryQuery = () =>
	queryOptions({
		queryKey: ["portfolio-history"],
		queryFn: fetchPortfolioHistory,
		staleTime: 60_000, // 1 minute
		gcTime: 10 * 60_000, // 10 minutes
	});

// ==========================================
// INVOCATIONS (CONVERSATIONS)
// ==========================================

/**
 * Fetch conversation invocations snapshot
 * Cache: 20 seconds
 */
export const invocationsQuery = () =>
	queryOptions({
		queryKey: ["invocations"],
		queryFn: refreshConversationEvents,
		staleTime: 20_000, // 20 seconds
		gcTime: 3 * 60_000, // 3 minutes
	});

// ==========================================
// MODELS LIST
// ==========================================

async function fetchModelsList() {
	const rows = await db
		.select({ id: models.id, name: models.name })
		.from(models)
		.orderBy(asc(models.name));

	return rows;
}

/**
 * Fetch all models (simple list)
 * Cache: 30 seconds (models rarely change)
 */
export const modelsListQuery = () =>
	queryOptions({
		queryKey: ["models", "simple-list"],
		queryFn: fetchModelsList,
		staleTime: 30_000, // 30 seconds
		gcTime: 5 * 60_000, // 5 minutes
	});
