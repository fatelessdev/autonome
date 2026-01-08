import { queryOptions } from "@tanstack/react-query";
import { and, asc, desc, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { models, orders } from "@/db/schema";
import { DEFAULT_SIMULATOR_OPTIONS, IS_SIMULATION_ENABLED } from "@/env";
import { fetchCandlesticksRest } from "@/server/integrations/lighter";
import { ExchangeSimulator } from "@/server/features/simulator/exchangeSimulator";
import { closeOrder, getOpenOrdersByModel } from "@/server/db/ordersRepository.server";
import { refreshConversationEvents } from "@/server/features/trading/conversationsSnapshot.server";
import { formatIstTimestamp } from "@/shared/formatting/dateFormat";
import { normalizeNumber } from "@/shared/formatting/numberFormat";
import { MARKETS } from "@/shared/markets/marketMetadata";

// ==========================================
// CRYPTO PRICES
// ==========================================

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
				// Use REST API directly - SDK's CandlestickApi is outdated
				const candles = await fetchCandlesticksRest({
					market_id: market.marketId,
					resolution: "1m",
					start_timestamp: now - 1000 * 60 * 15,
					end_timestamp: now,
					count_back: 1,
				});
				const last = candles?.[candles.length - 1];
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

// ==========================================
// TRADES
// ==========================================

type TradeRecord = {
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
};

export type FetchTradesOptions = {
	variant?: "Guardian" | "Apex" | "Gladiator" | "Sniper" | "Trendsurfer" | "Contrarian";
	limit?: number;
};

export async function fetchTrades(options?: FetchTradesOptions): Promise<TradeRecord[]> {
	const { variant, limit = 100 } = options ?? {};

	// If a specific variant is requested, fetch only for that variant
	const variants = variant
		? [variant]
		: (["Guardian", "Apex", "Gladiator", "Sniper", "Trendsurfer", "Contrarian"] as const);
	const LIMIT_PER_VARIANT = Math.ceil(limit / variants.length);

	const variantQueries = variants.map((v) =>
		db.query.orders.findMany({
			where: and(
				eq(orders.status, "CLOSED"),
				inArray(
					orders.modelId,
					db
						.select({ id: models.id })
						.from(models)
						.where(eq(models.variant, v)),
				),
			),
			with: {
				model: {
					columns: {
						name: true,
						openRouterModelName: true,
						variant: true,
					},
				},
			},
			orderBy: desc(orders.closedAt),
			limit: LIMIT_PER_VARIANT,
		}),
	);

	const variantResults = await Promise.all(variantQueries);
	const closedOrders = variantResults
		.flat()
		.sort(
			(a, b) =>
				(b.closedAt?.getTime() ?? 0) - (a.closedAt?.getTime() ?? 0),
		);

	return closedOrders.map((order) => {
		const openedAt = order.openedAt;
		const closedAt = order.closedAt ?? new Date();
		const holdingTime = formatDuration(openedAt, closedAt);
		const quantity = parseFloat(order.quantity) || null;
		const entryPrice = parseFloat(order.entryPrice) || null;
		const exitPrice = order.exitPrice ? parseFloat(order.exitPrice) : null;

		return {
			id: order.id,
			modelId: order.modelId,
			modelName: order.model?.name ?? "Unknown",
			modelRouterName: order.model?.openRouterModelName ?? null,
			modelVariant: order.model?.variant ?? "Guardian",
			symbol: order.symbol,
			side: order.side,
			quantity,
			entryPrice,
			exitPrice,
			netPnl: order.realizedPnl ? parseFloat(order.realizedPnl) : null,
			openedAt: openedAt.toISOString(),
			closedAt: closedAt.toISOString(),
			holdingTime,
			timestamp: formatIstTimestamp(closedAt),
		};
	});
}

/**
 * Fetch all trades (closed positions)
 * Cache: 15 seconds (frequently updated)
 */
export const tradesQuery = () =>
	queryOptions({
		queryKey: ["trades"],
		queryFn: () => fetchTrades(),
		staleTime: 15_000, // 15 seconds
		gcTime: 2 * 60_000, // 2 minutes
	});

// ==========================================
// POSITIONS (from Orders table with live reconciliation)
// ==========================================

/**
 * Reconcile DB orders against live simulator/exchange state.
 * Closes any DB orders that are no longer present in live positions.
 */
async function reconcilePositionsWithLive(
	modelId: string,
	liveSymbols: Set<string>,
	priceMap: Map<string, number | null>,
): Promise<void> {
	const dbOrders = await getOpenOrdersByModel(modelId);

	for (const order of dbOrders) {
		const normalizedSymbol = order.symbol.toUpperCase();
		if (!liveSymbols.has(normalizedSymbol)) {
			// Position exists in DB but not in live state — it was closed externally
			const exitPrice = priceMap.get(normalizedSymbol) ?? parseFloat(order.entryPrice);
			const entryPrice = parseFloat(order.entryPrice) || 0;
			const quantity = parseFloat(order.quantity) || 0;
			const isLong = order.side === "LONG";
			const pnl = isLong
				? (exitPrice - entryPrice) * quantity
				: (entryPrice - exitPrice) * quantity;

			try {
				await closeOrder({
					orderId: order.id,
					exitPrice: exitPrice.toString(),
					realizedPnl: pnl.toString(),
				});
			} catch (closeError) {
				console.error(
					`[Reconcile] Failed to close stale order ${order.id}:`,
					closeError,
				);
			}
		}
	}
}

export type FetchPositionsOptions = {
	variant?: "Guardian" | "Apex" | "Gladiator" | "Sniper" | "Trendsurfer" | "Contrarian";
};

export async function fetchPositions(options?: FetchPositionsOptions) {
	const { variant } = options ?? {};

	try {
		// Fetch models - filter by variant if specified
		const dbModels = variant
			? await db
					.select({
						id: models.id,
						name: models.name,
						modelLogo: models.openRouterModelName,
						variant: models.variant,
						lighterApiKey: models.lighterApiKey,
						accountIndex: models.accountIndex,
						invocationCount: models.invocationCount,
						totalMinutes: models.totalMinutes,
					})
					.from(models)
					.where(eq(models.variant, variant))
			: await db
					.select({
						id: models.id,
						name: models.name,
						modelLogo: models.openRouterModelName,
						variant: models.variant,
						lighterApiKey: models.lighterApiKey,
						accountIndex: models.accountIndex,
						invocationCount: models.invocationCount,
						totalMinutes: models.totalMinutes,
					})
					.from(models);

		// Get full simulator snapshots - this is the single source of truth for all position data
		// Using snapshots ensures UI shows exact same values as the model prompt
		const simulatorSnapshotsByModel = new Map<
			string,
			Awaited<ReturnType<typeof ExchangeSimulator.prototype.getAccountSnapshot>>
		>();
		const livePositionsByModel = new Map<string, Set<string>>();
		if (IS_SIMULATION_ENABLED) {
			const simulator = await ExchangeSimulator.bootstrap(DEFAULT_SIMULATOR_OPTIONS);
			for (const model of dbModels) {
				const snapshot = simulator.getAccountSnapshot(model.id);
				simulatorSnapshotsByModel.set(model.id, snapshot);
				const symbolSet = new Set(
					snapshot.positions.map((p) => p.symbol.toUpperCase()),
				);
				livePositionsByModel.set(model.id, symbolSet);
			}
		}

		// Fetch open orders directly from Orders table (single source of truth)
		const openOrders = await db.query.orders.findMany({
			where: eq(orders.status, "OPEN"),
		});

		// Group orders by model
		const ordersByModel = new Map<string, typeof openOrders>();
		for (const order of openOrders) {
			const existing = ordersByModel.get(order.modelId) ?? [];
			existing.push(order);
			ordersByModel.set(order.modelId, existing);
		}

		// Get all unique symbols for price fetching
		const allSymbols = [...new Set(openOrders.map((o) => o.symbol))];
		const livePrices =
			allSymbols.length > 0 ? await fetchCryptoPrices(allSymbols) : [];
		const priceMap = new Map(
			livePrices.map((p) => [p.symbol.toUpperCase(), p.price]),
		);

		// Reconcile DB orders against live state (close stale orders)
		if (IS_SIMULATION_ENABLED) {
			await Promise.all(
				dbModels.map((model) => {
					const liveSymbols = livePositionsByModel.get(model.id) ?? new Set();
					return reconcilePositionsWithLive(model.id, liveSymbols, priceMap);
				}),
			);

			// Re-fetch open orders after reconciliation
			const reconciled = await db.query.orders.findMany({
				where: eq(orders.status, "OPEN"),
			});
			ordersByModel.clear();
			for (const order of reconciled) {
				const existing = ordersByModel.get(order.modelId) ?? [];
				existing.push(order);
				ordersByModel.set(order.modelId, existing);
			}
		}

		// Fetch total realized P&L per model from closed orders
		const closedOrders = await db.query.orders.findMany({
			where: eq(orders.status, "CLOSED"),
			columns: {
				modelId: true,
				realizedPnl: true,
			},
		});
		const realizedPnlByModel = new Map<string, number>();
		for (const order of closedOrders) {
			const current = realizedPnlByModel.get(order.modelId) ?? 0;
			realizedPnlByModel.set(
				order.modelId,
				current + (parseFloat(order.realizedPnl ?? "0") || 0),
			);
		}

		const results = dbModels.map((model) => {
			try {
				// When simulation is enabled, use simulator's position data directly
				// This ensures UI shows exact same values as the model prompt (single source of truth)
				if (IS_SIMULATION_ENABLED) {
					const snapshot = simulatorSnapshotsByModel.get(model.id);
					if (snapshot) {
						// Get exit plans from DB orders (simulator doesn't persist all metadata)
						const modelOrders = ordersByModel.get(model.id) ?? [];
						const exitPlansBySymbol = new Map(
							modelOrders.map((o) => [o.symbol.toUpperCase(), o.exitPlan]),
						);
						const openedAtBySymbol = new Map(
							modelOrders.map((o) => [
								o.symbol.toUpperCase(),
								o.openedAt?.toISOString() ?? null,
							]),
						);

						const enrichedPositions = snapshot.positions.map((pos) => {
							const symbolUpper = pos.symbol.toUpperCase();
							const exitPlan = exitPlansBySymbol.get(symbolUpper) ?? null;

							return {
								symbol: pos.symbol,
								position: `${pos.quantity} ${pos.symbol}`,
								sign: pos.side,
								side: pos.side,
								quantity: pos.quantity,
								entryPrice: pos.avgEntryPrice,
								markPrice: pos.markPrice,
								currentPrice: pos.markPrice,
								notional: pos.notional.toFixed(2),
								unrealizedPnl: pos.unrealizedPnl.toFixed(2),
								realizedPnl: pos.realizedPnl.toFixed(2),
								liquidationPrice: "N/A",
								leverage: pos.leverage,
								confidence: exitPlan?.confidence ?? null,
								signal: pos.side,
								exitPlan: exitPlan ?? pos.exitPlan,
								lastDecisionAt: openedAtBySymbol.get(symbolUpper) ?? null,
								decisionStatus: "FILLED",
							};
						});

						return {
							modelId: model.id,
							modelName: model.name,
							modelLogo: model.modelLogo,
							modelVariant: model.variant,
							positions: enrichedPositions,
							totalUnrealizedPnl: snapshot.totalUnrealizedPnl,
							availableCash: snapshot.availableCash,
						};
					}
				}

				// Fallback: Build positions from DB orders (used when simulator is disabled)
				const modelOrders = ordersByModel.get(model.id) ?? [];
				const enrichedPositions = modelOrders.map((order) => {
					const currentPrice =
						priceMap.get(order.symbol.toUpperCase()) ?? null;
					const entryPrice = parseFloat(order.entryPrice) || 0;
					const quantity = parseFloat(order.quantity) || 0;
					const leverage = order.leverage
						? parseFloat(order.leverage)
						: null;

					// Calculate notional value (quantity * entry price)
					const notional = quantity * entryPrice;

					// Calculate unrealized PnL
					let unrealizedPnlNum = 0;
					if (currentPrice != null && entryPrice && quantity) {
						const isLong = order.side === "LONG";
						unrealizedPnlNum = isLong
							? (currentPrice - entryPrice) * quantity
							: (entryPrice - currentPrice) * quantity;
					}

					return {
						symbol: order.symbol,
						position: `${quantity} ${order.symbol}`,
						sign: order.side,
						side: order.side,
						quantity,
						entryPrice,
						markPrice: currentPrice,
						currentPrice,
						notional: notional.toFixed(2),
						unrealizedPnl: unrealizedPnlNum.toFixed(2),
						realizedPnl: "0.00",
						liquidationPrice: "N/A",
						leverage,
						confidence: order.exitPlan?.confidence ?? null,
						signal: order.side,
						exitPlan: order.exitPlan,
						lastDecisionAt: order.openedAt?.toISOString() ?? null,
						decisionStatus: "FILLED",
					};
				});

				// Calculate totals for non-simulation mode
				const totalUnrealizedPnl = enrichedPositions.reduce(
					(sum, p) => sum + parseFloat(p.unrealizedPnl),
					0,
				);

				const totalMarginUsed = enrichedPositions.reduce((sum, p) => {
					const notional = parseFloat(p.notional);
					const lev = p.leverage ?? 1;
					return sum + notional / lev;
				}, 0);
				const totalRealizedPnl = realizedPnlByModel.get(model.id) ?? 0;
				const initialCapital = DEFAULT_SIMULATOR_OPTIONS.initialCapital;
				const availableCash = Math.max(
					initialCapital - totalMarginUsed + totalRealizedPnl,
					0,
				);

				return {
					modelId: model.id,
					modelName: model.name,
					modelLogo: model.modelLogo,
					modelVariant: model.variant,
					positions: enrichedPositions,
					totalUnrealizedPnl,
					availableCash,
				};
			} catch (error) {
				console.error(`Error fetching positions for ${model.id}`, error);
				return {
					modelId: model.id,
					modelName: model.name,
					modelLogo: model.modelLogo,
					modelVariant: model.variant,
					positions: [],
					totalUnrealizedPnl: 0,
					availableCash: DEFAULT_SIMULATOR_OPTIONS.initialCapital,
				};
			}
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
		queryFn: () => fetchPositions(),
		staleTime: 15_000, // 15 seconds
		gcTime: 2 * 60_000, // 2 minutes
		refetchInterval: 30_000, // Auto-refresh every 30 seconds
	});

// ==========================================
// PORTFOLIO HISTORY
// ==========================================

import {
	getPortfolioHistoryWithResolution,
	downsampleForChart,
	type DownsampleResolution,
} from "@/server/features/portfolio/retentionService";

export type PortfolioHistoryOptions = {
	variant?: string;
	startDate?: Date;
	endDate?: Date;
	/** Ignored - resolution is now auto-detected from time range */
	maxPoints?: number;
	/** Force a specific resolution (auto-detected if not provided) */
	resolution?: DownsampleResolution;
};

export async function fetchPortfolioHistory(options?: PortfolioHistoryOptions) {
	// When no variant is specified (aggregate mode), we're averaging across all variants
	const isAggregateMode = !options?.variant;
	
	// Fetch all raw data from DB (retention policy already handles old data aggregation)
	// We don't limit at DB level anymore - time-based downsampling handles reduction
	const entries = await getPortfolioHistoryWithResolution({
		variant: options?.variant,
		startDate: options?.startDate,
		endDate: options?.endDate,
		// Remove maxPoints limit - let time-based downsampling handle it
		maxPoints: undefined,
	});

	// Apply time-based downsampling (auto-detects resolution from data range)
	// In aggregate mode, average across all variants per model
	return downsampleForChart(entries, options?.resolution, isAggregateMode);
}

/**
 * Fetch portfolio history for all models
 * Cache: 1 minute (updated every minute via scheduler)
 */
export const portfolioHistoryQuery = () =>
	queryOptions({
		queryKey: ["portfolio-history"],
		queryFn: () => fetchPortfolioHistory(),
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

export async function fetchModelsList() {
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
