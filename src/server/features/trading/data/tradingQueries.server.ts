/**
 * Server-side query functions for trading data.
 *
 * Prices are fetched via Alpaca market data.
 */

import { queryOptions } from "@tanstack/react-query";
import { and, asc, desc, eq, inArray, isNull, ne, or } from "drizzle-orm";
import {
	isValidVariantId,
	VARIANT_IDS,
	type VariantId,
} from "@/core/shared/variants";
import { db } from "@/db";
import { models, orders } from "@/db/schema";
import { fetchLatestDecisionIndex } from "@/server/features/trading/contracts/decisionIndex";
import { refreshConversationEvents } from "@/server/features/trading/data/conversationsSnapshot.server";
import { enrichOpenPositions } from "@/server/features/trading/data/openPositionEnrichment";
import { getOpenPositions } from "@/server/features/trading/data/positions";
import { getMarketDataProvider } from "@/server/providers/alpaca";
import { formatDuration, formatIstTimestamp } from "@/core/shared/formatting/dateFormat";
import { toAlpacaSymbol, toCanonical } from "@/core/shared/markets/marketMetadata";
import { requireFiniteNumber, requirePresent } from "@/core/shared/trading/calculations";

// ==========================================
// CRYPTO PRICES
// ==========================================

const parseRequiredFiniteNumber = (
	value: string | null | undefined,
	fieldName: string,
	context: string,
): number => {
	if (!value) {
		throw new Error(`Missing numeric ${fieldName} in ${context}`);
	}
	const parsed = Number.parseFloat(value);
	if (!Number.isFinite(parsed)) {
		throw new Error(`Invalid numeric ${fieldName} in ${context}: ${value}`);
	}
	return parsed;
};

const requireModelCredentials = (model: {
	id: string;
	alpacaApiKey: string | null;
	alpacaApiSecret: string | null;
}): { apiKey: string; apiSecret: string } => {
	if (!model.alpacaApiKey || !model.alpacaApiSecret) {
		throw new Error(`Missing Alpaca credentials for model ${model.id}`);
	}
	return {
		apiKey: model.alpacaApiKey,
		apiSecret: model.alpacaApiSecret,
	};
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

	const creds = await getAnyAlpacaCredentials();
	if (!creds) {
		throw new Error("No Alpaca credentials available in any model");
	}

	const md = getMarketDataProvider(creds.alpacaApiKey, creds.alpacaApiSecret);

	const snapshots = await md.getSnapshots(alpacaSymbols);

	return normalized.map((canonical, i) => {
		const snap = snapshots[alpacaSymbols[i]];
		const price =
			snap?.latest_trade?.price ?? snap?.latest_quote?.ask_price ?? null;
		if (price == null || !Number.isFinite(price)) {
			throw new Error(
				`Missing latest price for ${canonical} (alpacaSymbol=${alpacaSymbols[i]})`,
			);
		}
		return { symbol: canonical, price };
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
	variant?: VariantId;
	limit?: number;
};

export const tradesQuery = (options?: FetchTradesOptions) =>
	queryOptions({
		queryKey: ["trades", options?.variant ?? "all", options?.limit ?? 100],
		queryFn: () => fetchTrades(options),
		staleTime: 30_000,
		gcTime: 5 * 60_000,
	});

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
	const closedOrders = variantResults.flat().sort((a, b) => {
		if (!a.closedAt) {
			throw new Error(`Closed order ${a.id} is missing closedAt`);
		}
		if (!b.closedAt) {
			throw new Error(`Closed order ${b.id} is missing closedAt`);
		}
		return b.closedAt.getTime() - a.closedAt.getTime();
	});

	return closedOrders.map((order) => {
		if (!order.model) {
			throw new Error(
				`Closed order ${order.id} is missing required model relation`,
			);
		}
		if (!order.closedAt) {
			throw new Error(`Closed order ${order.id} is missing closedAt`);
		}
		if (!isValidVariantId(order.model.variant)) {
			throw new Error(
				`Closed order ${order.id} has invalid model variant: ${order.model.variant}`,
			);
		}

		const openedAt = order.openedAt;
		const closedAt = order.closedAt;
		const holdingTime = formatDuration(openedAt, closedAt);
		const quantity = parseRequiredFiniteNumber(
			order.quantity,
			"quantity",
			`order:${order.id}`,
		);
		const entryPrice = parseRequiredFiniteNumber(
			order.entryPrice,
			"entryPrice",
			`order:${order.id}`,
		);
		const exitPrice = parseRequiredFiniteNumber(
			order.exitPrice,
			"exitPrice",
			`order:${order.id}`,
		);

		return {
			id: order.id,
			modelId: order.modelId,
			modelName: order.model.name,
			modelRouterName: order.model.openRouterModelName ?? null,
			modelVariant: order.model.variant,
			symbol: order.symbol,
			side: order.side,
			quantity,
			entryPrice,
			exitPrice,
			netPnl: parseRequiredFiniteNumber(
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

export const positionsQuery = (options?: FetchPositionsOptions) =>
	queryOptions({
		queryKey: ["positions", options?.variant ?? "all"],
		queryFn: () => fetchPositions(options),
		staleTime: 15_000,
		gcTime: 2 * 60_000,
		refetchInterval: 30_000,
	});

export async function fetchPositions(options?: FetchPositionsOptions) {
	const { variant } = options ?? {};
	const normalizedVariant = isValidVariantId(variant) ? variant : undefined;

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

	const results = await Promise.all(
		dbModels.map(async (model) => {
			const { apiKey, apiSecret } = requireModelCredentials(model);

			const [livePositionsRaw, decisionIndex] = await Promise.all([
				getOpenPositions({
					id: model.id,
					name: model.name,
					modelName: model.modelLogo,
					alpacaApiKey: apiKey,
					alpacaApiSecret: apiSecret,
					invocationCount: model.invocationCount,
					totalMinutes: model.totalMinutes,
					variant: model.variant,
				}),
				fetchLatestDecisionIndex(model.id),
			]);

			const livePositions = enrichOpenPositions(
				livePositionsRaw,
				decisionIndex,
			);

			const positions = livePositions.map((pos) => {
				const entryPrice = requirePresent(
					pos.entryPrice,
					`open position ${pos.symbol} on model ${model.id}.entryPrice`,
				);
				const notional = requirePresent(
					pos.notional,
					`open position ${pos.symbol} on model ${model.id}.notional`,
				);

				return {
					symbol: pos.symbol,
					position: pos.position,
					side: pos.side,
					quantity: pos.quantity,
					entryPrice,
					markPrice: pos.markPrice ?? null,
					currentPrice: pos.markPrice ?? null,
					notional,
					unrealizedPnl: pos.unrealizedPnl,
					realizedPnl: pos.realizedPnl,
					liquidationPrice: pos.liquidationPrice ?? null,
					confidence: pos.confidence ?? null,
					exitPlan: pos.exitPlan ?? null,
					lastDecisionAt: pos.lastDecisionAt ?? null,
					decisionStatus: pos.decisionStatus ?? null,
				};
			});

			const totalUnrealizedPnl = positions.reduce((sum, position) => {
				const pnl = requireFiniteNumber(
					position.unrealizedPnl,
					`model:${model.id}:${position.symbol}.unrealizedPnl`,
				);
				return sum + pnl;
			}, 0);

			return {
				modelId: model.id,
				modelName: model.name,
				modelLogo: model.modelLogo,
				modelVariant: model.variant,
				positions,
				totalUnrealizedPnl,
			};
		}),
	);

	return results;
}

// ==========================================
// PORTFOLIO HISTORY
// ==========================================

import {
	type DownsampleResolution,
	type DownsampleResult,
	downsampleForChart,
	getPortfolioHistoryWithResolution,
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

export const cryptoPricesQuery = (symbols: string[]) => {
	const normalized = symbols
		.map((symbol) => toCanonical(symbol).toUpperCase())
		.sort((a, b) => a.localeCompare(b));

	return queryOptions({
		queryKey: ["crypto-prices", ...normalized],
		queryFn: () => fetchCryptoPrices(normalized),
		staleTime: 10_000,
		gcTime: 2 * 60_000,
	});
};

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

export function fetchModelsList() {
	return db
		.select({ id: models.id, name: models.name })
		.from(models)
		.orderBy(asc(models.name));
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
