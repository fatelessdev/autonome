/**
 * Server-side query functions for trading data.
 *
 * Prices are fetched via Alpaca market data.
 */

import { queryOptions } from "@tanstack/react-query";
import { and, asc, desc, eq, inArray, isNull, ne, or } from "drizzle-orm";

import { db } from "@/db";
import { models, orders } from "@/db/schema";
import {
	DEFAULT_VARIANT,
	isValidVariantId,
	VARIANT_IDS,
	type VariantId,
} from "@/core/shared/variants";
import { toAlpacaSymbol, toCanonical } from "@/shared/markets/marketMetadata";
import { refreshConversationEvents } from "@/server/features/trading/data/conversationsSnapshot.server";
import { formatIstTimestamp } from "@/shared/formatting/dateFormat";
import { getMarketDataProvider } from "@/server/providers/alpaca";
import { getOpenPositions } from "@/server/features/trading/data/positions";

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

const parseFiniteNumber = (
	value: string | null | undefined,
	fieldName: string,
	context: string,
): number | null => {
	if (!value) return null;
	const parsed = Number.parseFloat(value);
	if (!Number.isFinite(parsed)) {
		console.warn(
			`[queries] Invalid numeric ${fieldName} in ${context}: ${value}`,
		);
		return null;
	}
	return parsed;
};

/**
 * Get any model's Alpaca credentials for shared market data access.
 * Market data is the same regardless of which account fetches it.
 */
async function getAnyAlpacaCredentials(): Promise<{
	alpacaApiKey: string;
	alpacaApiSecret: string;
} | null> {
	const [first] = await db
		.select({
			alpacaApiKey: models.alpacaApiKey,
			alpacaApiSecret: models.alpacaApiSecret,
		})
		.from(models)
		.limit(1);

	if (!first?.alpacaApiKey || !first?.alpacaApiSecret) return null;
	return first;
}

/**
 * Fetch latest prices for a list of canonical symbols (e.g. ["BTC", "ETH"])
 * via Alpaca market data snapshots.
 */
export async function fetchCryptoPrices(
	symbols: string[],
): Promise<Array<{ symbol: string; price: number | null }>> {
	if (symbols.length === 0) return [];

	const normalized = symbols.map((s) => toCanonical(s).toUpperCase());
	const alpacaSymbols = normalized.map((s) => toAlpacaSymbol(s));

	try {
		const creds = await getAnyAlpacaCredentials();
		if (!creds) {
			console.warn("[crypto-prices] No Alpaca credentials available in any model");
			return normalized.map((s) => ({ symbol: s, price: null }));
		}

		const md = getMarketDataProvider(creds.alpacaApiKey, creds.alpacaApiSecret);

		const snapshots = await md.getSnapshots(alpacaSymbols);

		return normalized.map((canonical, i) => {
			const snap = snapshots[alpacaSymbols[i]];
			const price = snap?.latest_trade?.price ?? snap?.latest_quote?.ask_price ?? null;
			return { symbol: canonical, price };
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.warn("[crypto-prices] Failed to fetch from Alpaca:", message);
		return normalized.map((s) => ({ symbol: s, price: null }));
	}
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
	variant?: VariantId;
	limit?: number;
};

export async function fetchTrades(
	options?: FetchTradesOptions,
): Promise<TradeRecord[]> {
	const { variant, limit = 100 } = options ?? {};
	const normalizedVariant = isValidVariantId(variant) ? variant : undefined;

	const variants = normalizedVariant ? [normalizedVariant] : VARIANT_IDS;
	const LIMIT_PER_VARIANT = Math.ceil(limit / variants.length);

	const variantQueries = variants.map((v) => {
		// Subquery: get model IDs for this specific variant
		const variantModelIds = db
			.select({ id: models.id })
			.from(models)
			.where(eq(models.variant, v));

		return db.query.orders.findMany({
			where: and(
				eq(orders.status, "CLOSED"),
				or(isNull(orders.closeTrigger), ne(orders.closeTrigger, "adjustment")),
				inArray(orders.modelId, variantModelIds),
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
		});
	});

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
		const quantity = parseFiniteNumber(
			order.quantity,
			"quantity",
			`order:${order.id}`,
		);
		const entryPrice = parseFiniteNumber(
			order.entryPrice,
			"entryPrice",
			`order:${order.id}`,
		);
		const exitPrice = parseFiniteNumber(
			order.exitPrice,
			"exitPrice",
			`order:${order.id}`,
		);

		return {
			id: order.id,
			modelId: order.modelId,
			modelName: order.model?.name ?? "Unknown",
			modelRouterName: order.model?.openRouterModelName ?? null,
			modelVariant: order.model?.variant ?? DEFAULT_VARIANT,
			symbol: order.symbol,
			side: order.side,
			quantity,
			entryPrice,
			exitPrice,
			netPnl: parseFiniteNumber(
				order.realizedPnl,
				"realizedPnl",
				`order:${order.id}`,
			),
			openedAt: openedAt.toISOString(),
			closedAt: closedAt.toISOString(),
			holdingTime,
			timestamp: formatIstTimestamp(closedAt),
		};
	});
}

// ==========================================
// POSITIONS (Alpaca live + DB metadata)
// ==========================================

export type FetchPositionsOptions = {
	variant?: VariantId;
};

export async function fetchPositions(options?: FetchPositionsOptions) {
	const { variant } = options ?? {};
	const normalizedVariant = isValidVariantId(variant) ? variant : undefined;

	try {
		// Fetch models - filter by variant if specified
		const modelFilter = normalizedVariant
			? eq(models.variant, normalizedVariant)
			: undefined;

		const dbModels = await db
			.select({
				id: models.id,
				name: models.name,
				modelLogo: models.openRouterModelName,
				variant: models.variant,
				alpacaApiKey: models.alpacaApiKey,
				alpacaApiSecret: models.alpacaApiSecret,
				invocationCount: models.invocationCount,
				totalMinutes: models.totalMinutes,
			})
			.from(models)
			.where(modelFilter);

		const results = await Promise.all(dbModels.map(async (model) => {
			try {
				if (!model.alpacaApiKey || !model.alpacaApiSecret) {
					return {
						modelId: model.id,
						modelName: model.name,
						modelLogo: model.modelLogo,
						modelVariant: model.variant,
						positions: [],
						totalUnrealizedPnl: 0,
					};
				}

				const livePositions = await getOpenPositions({
					id: model.id,
					name: model.name,
					modelName: model.modelLogo,
					alpacaApiKey: model.alpacaApiKey,
					alpacaApiSecret: model.alpacaApiSecret,
					invocationCount: model.invocationCount,
					totalMinutes: model.totalMinutes,
					variant: model.variant,
				});

				const positions = livePositions.map((pos) => {
					if (pos.entryPrice == null) {
						throw new Error(
							`Missing entryPrice for open position ${pos.symbol} on model ${model.id}`,
						);
					}

					return {
					symbol: pos.symbol,
					position: pos.position,
					sign: pos.sign,
					side: pos.sign,
					quantity: pos.quantity,
					entryPrice: pos.entryPrice,
					markPrice: pos.markPrice ?? null,
					currentPrice: pos.markPrice ?? null,
					notional: pos.notional ?? "0.00",
					unrealizedPnl: pos.unrealizedPnl,
					realizedPnl: pos.realizedPnl,
					liquidationPrice: pos.liquidationPrice ?? "N/A",
					leverage: null,
					confidence: pos.confidence ?? null,
					signal: pos.signal ?? pos.sign,
					exitPlan: pos.exitPlan
						? {
							...pos.exitPlan,
							confidence: pos.confidence ?? null,
						}
						: null,
					lastDecisionAt: pos.lastDecisionAt ?? null,
					decisionStatus: pos.decisionStatus ?? null,
					};
				});

				const totalUnrealizedPnl = positions.reduce((sum, position) => {
					const pnl = parseFiniteNumber(
						position.unrealizedPnl,
						"unrealizedPnl",
						`model:${model.id}:${position.symbol}`,
					);
					return sum + (pnl ?? 0);
				}, 0);

				return {
					modelId: model.id,
					modelName: model.name,
					modelLogo: model.modelLogo,
					modelVariant: model.variant,
					positions,
					totalUnrealizedPnl,
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
				};
			}
		}));

		return results;
	} catch (error) {
		console.error("Error in fetchPositions function", error);
		throw error;
	}
}

// ==========================================
// PORTFOLIO HISTORY
// ==========================================

import {
	getPortfolioHistoryWithResolution,
	downsampleForChart,
	type DownsampleResolution,
	type DownsampleResult,
} from "@/server/features/portfolio/retentionService";

export type { DownsampleResolution };

export type PortfolioHistoryOptions = {
	variant?: string;
	startDate?: Date;
	endDate?: Date;
	/** Ignored - resolution is now auto-detected from time range */
	maxPoints?: number;
	/** Force a specific resolution (auto-detected if not provided) */
	resolution?: DownsampleResolution;
};

export type PortfolioHistoryResult = {
	history: DownsampleResult["entries"];
	resolution: DownsampleResolution;
};

export async function fetchPortfolioHistory(
	options?: PortfolioHistoryOptions,
): Promise<PortfolioHistoryResult> {
	const isAggregateMode = !options?.variant;

	const entries = await getPortfolioHistoryWithResolution({
		variant: options?.variant,
		startDate: options?.startDate,
		endDate: options?.endDate,
		maxPoints: undefined,
	});

	const result = downsampleForChart(
		entries,
		options?.resolution,
		isAggregateMode,
	);

	return {
		history: result.entries,
		resolution: result.resolution,
	};
}

/**
 * Fetch portfolio history for all models
 * Cache: 1 minute (updated every minute via scheduler)
 */
export const portfolioHistoryQuery = () =>
	queryOptions({
		queryKey: ["portfolio-history"],
		queryFn: () => fetchPortfolioHistory(),
		staleTime: 60_000,
		gcTime: 10 * 60_000,
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
		staleTime: 20_000,
		gcTime: 3 * 60_000,
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
		staleTime: 30_000,
		gcTime: 5 * 60_000,
	});


