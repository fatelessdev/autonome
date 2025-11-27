import { queryOptions } from "@tanstack/react-query";
import { and, asc, desc, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { invocations, models, toolCalls } from "@/db/schema";
import { BASE_URL, DEFAULT_SIMULATOR_OPTIONS, IS_SIMULATION_ENABLED } from "@/env";
import {
	CandlestickApi,
	IsomorphicFetchHttpLibrary,
	ServerConfiguration,
} from "@/lighter/generated/index";
import { ExchangeSimulator } from "@/server/features/simulator/exchangeSimulator";
import { refreshConversationEvents } from "@/server/features/trading/conversationsSnapshot.server";
import { formatIstTimestamp } from "@/shared/formatting/dateFormat";
import { normalizeNumber } from "@/shared/formatting/numberFormat";
import { MARKETS } from "@/shared/markets/marketMetadata";
import { getArray, safeJsonParse } from "@/core/utils/json";

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
 * Cache: 30 seconds (highly volatile data)
 */
export const cryptoPricesQuery = (symbols: string[]) => {
	const normalizedSymbols = symbols.map((s) => s.toUpperCase()).sort();
	return queryOptions({
		queryKey: ["crypto-prices", ...normalizedSymbols],
		queryFn: () => fetchCryptoPrices(symbols),
		staleTime: 60_000, // 60 seconds
		gcTime: 60_000, // 60 seconds
		refetchInterval: 30_000, // Auto-refresh every 30 seconds
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
// POSITIONS (derived from tool calls)
// ==========================================

type OpenPositionFromToolCall = {
	symbol: string;
	side: string;
	quantity: number | null;
	entryPrice: number | null;
	leverage: number | null;
	confidence: number | null;
	exitPlan: {
		target: number | null;
		stop: number | null;
		invalidation: string | null;
	} | null;
	openedAt: Date;
	toolCallId: string;
};

/**
 * Derive open positions from tool calls.
 * An open position is a CREATE_POSITION that hasn't been matched by a CLOSE_POSITION.
 */
async function deriveOpenPositionsFromToolCalls(): Promise<
	Map<string, OpenPositionFromToolCall[]>
> {
	// Get all CREATE_POSITION calls
	const createCalls = await db
		.select({
			id: toolCalls.id,
			metadata: toolCalls.metadata,
			createdAt: toolCalls.createdAt,
			modelId: invocations.modelId,
		})
		.from(toolCalls)
		.innerJoin(invocations, eq(toolCalls.invocationId, invocations.id))
		.where(eq(toolCalls.toolCallType, "CREATE_POSITION"))
		.orderBy(asc(toolCalls.createdAt));

	// Get all CLOSE_POSITION calls
	const closeCalls = await db
		.select({
			id: toolCalls.id,
			metadata: toolCalls.metadata,
			createdAt: toolCalls.createdAt,
			modelId: invocations.modelId,
		})
		.from(toolCalls)
		.innerJoin(invocations, eq(toolCalls.invocationId, invocations.id))
		.where(eq(toolCalls.toolCallType, "CLOSE_POSITION"))
		.orderBy(asc(toolCalls.createdAt));

	// Build a map of created positions per model+symbol
	// Each entry is a stack (LIFO) of positions
	const openPositions = new Map<string, OpenPositionFromToolCall[]>();

	for (const call of createCalls) {
		const metadata = safeJsonParse<Record<string, unknown>>(call.metadata, {});

		// Skip updateExitPlan actions - they're not new positions
		if (metadata.action === "updateExitPlan") {
			continue;
		}

		// The metadata has "decisions" for inputs and "results" for execution outcomes
		const decisions = getArray<Record<string, unknown>>(metadata.decisions);
		const results = getArray<Record<string, unknown>>(metadata.results);

		// Match decisions with results to get successful positions
		for (let i = 0; i < decisions.length; i++) {
			const decision = decisions[i];
			const result = results[i] ?? {};

			// Skip if the position creation failed
			if (result.success !== true) {
				continue;
			}

			const symbol = canonicalSymbol(
				typeof decision.symbol === "string" ? decision.symbol : undefined,
			);
			if (!symbol) continue;

			const key = `${call.modelId}|${symbol}`;

			const record: OpenPositionFromToolCall = {
				symbol,
				side:
					typeof decision.side === "string"
						? decision.side.toUpperCase()
						: "LONG",
				quantity: normalizeNumber(result.quantity ?? decision.quantity),
				entryPrice: normalizeNumber(result.entryPrice),
				leverage: normalizeNumber(decision.leverage),
				confidence: normalizeNumber(decision.confidence),
				exitPlan: {
					target: normalizeNumber(decision.profitTarget),
					stop: normalizeNumber(decision.stopLoss),
					invalidation:
						typeof decision.invalidationCondition === "string"
							? decision.invalidationCondition
							: null,
				},
				openedAt: call.createdAt,
				toolCallId: call.id,
			};

			const existing = openPositions.get(key) ?? [];
			existing.push(record);
			openPositions.set(key, existing);
		}
	}

	// Remove closed positions (consume from the stack)
	for (const call of closeCalls) {
		const metadata = safeJsonParse<Record<string, unknown>>(call.metadata, {});
		const closedPositions = getArray<Record<string, unknown>>(
			metadata.closedPositions,
		);
		const fallbackSymbols = getArray<unknown>(metadata.symbols);

		for (let idx = 0; idx < closedPositions.length; idx++) {
			const position = closedPositions[idx];
			const symbolCandidate =
				typeof position.symbol === "string"
					? position.symbol
					: typeof fallbackSymbols[idx] === "string"
						? (fallbackSymbols[idx] as string)
						: undefined;
			const symbol = canonicalSymbol(symbolCandidate);
			if (!symbol) continue;

			const key = `${call.modelId}|${symbol}`;
			const stack = openPositions.get(key);
			if (stack && stack.length > 0) {
				// Find and remove the position that was opened before this close
				for (let i = stack.length - 1; i >= 0; i--) {
					if (stack[i].openedAt <= call.createdAt) {
						stack.splice(i, 1);
						break;
					}
				}
			}
		}
	}

	// Group remaining open positions by modelId
	const result = new Map<string, OpenPositionFromToolCall[]>();
	for (const [key, positions] of openPositions) {
		if (positions.length === 0) continue;
		const modelId = key.split("|")[0];
		const existing = result.get(modelId) ?? [];
		existing.push(...positions);
		result.set(modelId, existing);
	}

	return result;
}

export async function fetchPositions() {
	try {
		// Fetch all models
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

		// Derive open positions from tool calls
		const openPositionsByModel = await deriveOpenPositionsFromToolCalls();

		// Fetch all trades to calculate realized P&L per model
		const allTrades = await fetchTrades();
		const realizedPnlByModel = new Map<string, number>();
		for (const trade of allTrades) {
			const current = realizedPnlByModel.get(trade.modelId) ?? 0;
			realizedPnlByModel.set(trade.modelId, current + (trade.netPnl ?? 0));
		}

		const results = await Promise.all(
			dbModels.map(async (model) => {
				try {
					// Get derived positions for this model
					const derivedPositions = openPositionsByModel.get(model.id) ?? [];

					// Get live prices for all position symbols
					const livePrices =
						derivedPositions.length > 0
							? await fetchCryptoPrices(derivedPositions.map((p) => p.symbol))
							: [];

					const priceMap = new Map(
						livePrices.map((p) => [p.symbol.toUpperCase(), p.price]),
					);

					// Transform derived positions to expected format with live prices
					const enrichedPositions = derivedPositions.map((pos) => {
						const currentPrice = priceMap.get(pos.symbol.toUpperCase()) ?? null;
						const entryPrice = pos.entryPrice ?? 0;
						const quantity = pos.quantity ?? 0;

						// Calculate notional value (quantity * entry price)
						const notional = quantity * entryPrice;

						// Calculate unrealized PnL
						let unrealizedPnlNum: number = 0;
						if (currentPrice != null && entryPrice && quantity) {
							const isLong = pos.side === "LONG";
							unrealizedPnlNum = isLong
								? (currentPrice - entryPrice) * quantity
								: (entryPrice - currentPrice) * quantity;
						}

						return {
							symbol: pos.symbol,
							position: `${quantity} ${pos.symbol}`, // Human-readable position
							sign: pos.side,
							side: pos.side,
							quantity,
							entryPrice,
							markPrice: currentPrice,
							currentPrice,
							notional: notional.toFixed(2), // String for UI
							unrealizedPnl: unrealizedPnlNum.toFixed(2), // String for UI
							realizedPnl: "0.00", // No realized PnL for open positions
							liquidationPrice: "N/A", // Would need margin calc
							leverage: pos.leverage,
							confidence: pos.confidence,
							signal: pos.side,
							exitPlan: pos.exitPlan,
							lastDecisionAt: pos.openedAt?.toISOString() ?? null,
							decisionStatus: "FILLED",
						};
					});

					// Calculate total unrealized PnL (as number for model-level aggregation)
					const totalUnrealizedPnl = enrichedPositions.reduce(
						(sum, p) => sum + Number.parseFloat(p.unrealizedPnl),
						0,
					);

					// Calculate total margin used (sum of notional / leverage)
					const totalMarginUsed = enrichedPositions.reduce((sum, p) => {
						const notional = Number.parseFloat(p.notional);
						const leverage = p.leverage ?? 1;
						return sum + notional / leverage;
					}, 0);

					// Get total realized P&L for this model (from closed trades)
					const totalRealizedPnl = realizedPnlByModel.get(model.id) ?? 0;

					// Available cash = initial capital - margin used + realized PnL
					// Note: Unrealized P&L does NOT affect available cash - only realized P&L does
					const initialCapital = DEFAULT_SIMULATOR_OPTIONS.initialCapital;
					const calculatedAvailableCash = Math.max(
						initialCapital - totalMarginUsed + totalRealizedPnl,
						0,
					);

					return {
						modelId: model.id,
						modelName: model.name,
						modelLogo: model.modelLogo,
						positions: enrichedPositions,
						totalUnrealizedPnl,
						availableCash: calculatedAvailableCash,
					};
				} catch (error) {
					console.error(`Error fetching positions for ${model.id}`, error);
					return {
						modelId: model.id,
						modelName: model.name,
						modelLogo: model.modelLogo,
						positions: [],
						totalUnrealizedPnl: 0,
						availableCash: DEFAULT_SIMULATOR_OPTIONS.initialCapital,
					};
				}
			}),
		);

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
