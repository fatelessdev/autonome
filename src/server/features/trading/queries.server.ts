import { queryOptions } from "@tanstack/react-query";
import { asc, desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { models, orders } from "@/db/schema";
import { DEFAULT_SIMULATOR_OPTIONS, IS_SIMULATION_ENABLED } from "@/env";
import { candlestickApi } from "@/server/integrations/lighter";
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

// ==========================================
// TRADES
// ==========================================

type TradeRecord = {
	id: string;
	modelId: string;
	modelName: string;
	modelRouterName: string | null;
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

export async function fetchTrades(): Promise<TradeRecord[]> {
	// Fetch closed orders directly from Orders table
	const closedOrders = await db.query.orders.findMany({
		where: eq(orders.status, "CLOSED"),
		with: {
			model: {
				columns: {
					name: true,
					openRouterModelName: true,
				},
			},
		},
		orderBy: desc(orders.closedAt),
		limit: 100,
	});

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
		queryFn: fetchTrades,
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

		// Get live positions from simulator to reconcile with DB
		// This ensures UI shows same positions as model prompt
		const livePositionsByModel = new Map<string, Set<string>>();
		if (IS_SIMULATION_ENABLED) {
			const simulator = await ExchangeSimulator.bootstrap(DEFAULT_SIMULATOR_OPTIONS);
			for (const model of dbModels) {
				const livePositions = simulator.getOpenPositions(model.id);
				const symbolSet = new Set(livePositions.map((p) => p.symbol.toUpperCase()));
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
				const modelOrders = ordersByModel.get(model.id) ?? [];

				// Transform orders to expected position format with live prices
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

				// Calculate totals
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
