import {
	type QueryClient,
	queryOptions,
	useQuery,
} from "@tanstack/react-query";
import { isValidVariantId, type VariantId } from "@/core/shared/variants";
import { orpc } from "@/server/orpc/client";
import { SUPPORTED_MARKETS } from "@/core/shared/markets/marketMetadata";

export type MarketSymbol = (typeof SUPPORTED_MARKETS)[number];

export type MarketPrice = {
	symbol: MarketSymbol;
	price: number;
	change24h: number | null;
	source: "alpaca" | "cache";
	timestamp: string;
};

export type PortfolioHistoryEntry = {
	id: string;
	modelId: string;
	netPortfolio: string;
	createdAt: string;
	updatedAt: string;
	model?: {
		name: string;
		variant?: VariantId;
		openRouterModelName?: string;
	};
};

export type DownsampleResolution = "1m" | "5m" | "15m" | "1h" | "4h";

export type PortfolioHistoryResult = {
	history: PortfolioHistoryEntry[];
	resolution: DownsampleResolution;
};

const MARKET_QUERY_KEYS = {
	prices: (symbols: readonly MarketSymbol[]) =>
		["markets", "prices", [...symbols].sort((a, b) => a.localeCompare(b)).join(",")] as const,
} as const;

const PORTFOLIO_QUERY_KEYS = {
	history: (variant?: string) =>
		["portfolio", "history", variant ?? "all"] as const,
	latest: (variant?: string) =>
		["portfolio", "latest", variant ?? "all"] as const,
} as const;

function toMarketPrices(
	prices: Array<{ symbol: string; price: number }>,
	symbols: readonly MarketSymbol[],
): MarketPrice[] {
	const requestedSymbols = symbols.length > 0 ? symbols : SUPPORTED_MARKETS;
	const priceMap = new Map(
		prices
			.filter((p) =>
				SUPPORTED_MARKETS.includes(p.symbol.toUpperCase() as MarketSymbol),
			)
			.map((p) => [p.symbol.toUpperCase(), p.price]),
	);

	return requestedSymbols.map((symbol) => ({
		symbol,
		price: priceMap.get(symbol) ?? Number.NaN,
		change24h: null,
		source: "cache" as const,
		timestamp: new Date().toISOString(),
	}));
}

async function requestMarketPrices(symbols: readonly MarketSymbol[]) {
	const data = await orpc.trading.getCryptoPrices.call({
		symbols: [...symbols],
	});
	return toMarketPrices(data.prices, symbols);
}

export function marketPricesQueryOptions(
	symbols: readonly MarketSymbol[] = SUPPORTED_MARKETS,
) {
	return queryOptions({
		queryKey: MARKET_QUERY_KEYS.prices(symbols),
		queryFn: () => requestMarketPrices(symbols),
		staleTime: 10_000,
		gcTime: 5 * 60_000,
		refetchInterval: 10_000,
	});
}

export function prefetchMarketPrices(
	queryClient: QueryClient,
	symbols: readonly MarketSymbol[] = SUPPORTED_MARKETS,
) {
	return queryClient.ensureQueryData(marketPricesQueryOptions(symbols));
}

function normalizePortfolioHistory(
	payload: PortfolioHistoryResult,
): PortfolioHistoryResult {
	// oRPC validates shape via PortfolioHistoryResponseSchema — trust it
	return {
		history: payload.history.map((entry) => ({
			id: entry.id,
			modelId: entry.modelId,
			netPortfolio: entry.netPortfolio,
			createdAt: entry.createdAt,
			updatedAt: entry.updatedAt,
			model: entry.model
				? {
						name: entry.model.name,
						variant: isValidVariantId(entry.model.variant)
							? entry.model.variant
							: undefined,
						openRouterModelName: entry.model.openRouterModelName,
					}
				: undefined,
		})),
		resolution: payload.resolution,
	};
}

async function requestPortfolioHistory(
	variant?: VariantId,
): Promise<PortfolioHistoryResult> {
	// Server handles time-based downsampling automatically and returns resolution
	// Resolution is auto-detected from data time range:
	// - ≤24h: 1-minute buckets
	// - ≤3d: 5-minute buckets
	// - ≤7d: 15-minute buckets
	// - ≤30d: 1-hour buckets
	// - >30d: 4-hour buckets
	// Server also appends latest entry per model to ensure chart ends at current value
	const data = await orpc.trading.getPortfolioHistory.call({
		variant,
	});
	return normalizePortfolioHistory(data);
}

export const portfolioHistoryQueryOptions = (variant?: VariantId) =>
	queryOptions({
		queryKey: PORTFOLIO_QUERY_KEYS.history(variant),
		queryFn: () => requestPortfolioHistory(variant),
		staleTime: 3 * 60_000,
		gcTime: 15 * 60_000,
		refetchInterval: 3 * 60_000,
	});

export function prefetchPortfolioHistory(
	queryClient: QueryClient,
	variant?: VariantId,
) {
	return queryClient.ensureQueryData(portfolioHistoryQueryOptions(variant));
}

export const MARKET_QUERIES = {
	prices: marketPricesQueryOptions,
	prefetchPrices: prefetchMarketPrices,
};

export function useMarketPrices(
	symbols: readonly MarketSymbol[] = SUPPORTED_MARKETS,
) {
	return useQuery(marketPricesQueryOptions(symbols));
}

export const PORTFOLIO_QUERIES = {
	history: portfolioHistoryQueryOptions,
	prefetchHistory: prefetchPortfolioHistory,
};

// ==================== Variant History ====================

export type VariantHistoryPoint = {
	timestamp: string;
	value: number;
};

export type VariantHistoryEntry = {
	variantId: VariantId;
	label: string;
	color: string;
	history: VariantHistoryPoint[];
};

export type VariantHistoryResponse = {
	variants: VariantHistoryEntry[];
	aggregate: VariantHistoryPoint[];
};

const VARIANT_QUERY_KEYS = {
	history: (window: "24h" | "7d" | "30d") =>
		["portfolio", "variant-history", window] as const,
	stats: () => ["variants", "stats"] as const,
} as const;

async function requestVariantHistory(window: "24h" | "7d" | "30d") {
	const data = await orpc.variants.getVariantHistory.call({ window });
	return data;
}

export const variantHistoryQueryOptions = (
	window: "24h" | "7d" | "30d" = "7d",
) =>
	queryOptions({
		queryKey: VARIANT_QUERY_KEYS.history(window),
		queryFn: () => requestVariantHistory(window),
		staleTime: 3 * 60_000,
		gcTime: 15 * 60_000,
		refetchInterval: 3 * 60_000,
	});

async function requestVariantStats() {
	const data = await orpc.variants.getVariantStats.call({});
	return data.stats;
}

export const variantStatsQueryOptions = () =>
	queryOptions({
		queryKey: VARIANT_QUERY_KEYS.stats(),
		queryFn: requestVariantStats,
		staleTime: 3 * 60_000,
		gcTime: 15 * 60_000,
		refetchInterval: 3 * 60_000,
	});

export const VARIANT_QUERIES = {
	history: variantHistoryQueryOptions,
	stats: variantStatsQueryOptions,
};
