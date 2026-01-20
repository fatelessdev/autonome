import { type QueryClient, queryOptions, useQuery } from "@tanstack/react-query";

import { orpc } from "@/server/orpc/client";
import { SUPPORTED_MARKETS } from "./marketMetadata";
import { type VariantId, isValidVariantId } from "@/core/shared/variants";

export type MarketSymbol = (typeof SUPPORTED_MARKETS)[number];

export type MarketPrice = {
	symbol: MarketSymbol;
	price: number;
	change24h: number | null;
	source: "lighter" | "simulator" | "cache";
	timestamp: string;
};

export type MarketPricesResponse =
	| { prices?: Array<Record<string, unknown>> }
	| Array<Record<string, unknown>>
	| null
	| undefined;

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

export type PortfolioHistoryResponse =
	| PortfolioHistoryResult
	| PortfolioHistoryEntry[]
	| {
			history?: PortfolioHistoryEntry[];
			resolution?: DownsampleResolution;
	  }
	| null
	| undefined;

const MARKET_QUERY_KEYS = {
	prices: (symbols: readonly MarketSymbol[]) =>
		["markets", "prices", [...symbols].sort().join(",")] as const,
} as const;

const PORTFOLIO_QUERY_KEYS = {
	history: (variant?: string) => ["portfolio", "history", variant ?? "all"] as const,
	latest: (variant?: string) => ["portfolio", "latest", variant ?? "all"] as const,
} as const;

function normalizeMarketPrice(
	entry: Record<string, unknown>,
): MarketPrice | null {
	const { symbol, price, change24h, source, timestamp } = entry;
	const upperSymbol =
		typeof symbol === "string" ? (symbol.toUpperCase() as MarketSymbol) : null;
	if (!upperSymbol || !SUPPORTED_MARKETS.includes(upperSymbol)) {
		return null;
	}

	const numericPrice =
		typeof price === "number" && Number.isFinite(price) ? price : null;
	if (numericPrice == null) {
		return null;
	}

	return {
		symbol: upperSymbol,
		price: numericPrice,
		change24h:
			typeof change24h === "number" && Number.isFinite(change24h)
				? change24h
				: null,
		source:
			source === "lighter" || source === "simulator" || source === "cache"
				? source
				: "cache",
		timestamp:
			typeof timestamp === "string" ? timestamp : new Date().toISOString(),
	};
}

function normalizeMarketPrices(
	payload: MarketPricesResponse,
	symbols: readonly MarketSymbol[] = SUPPORTED_MARKETS,
): MarketPrice[] {
	const raw =
		payload && typeof payload === "object" && "prices" in payload
			? (payload.prices as Array<Record<string, unknown>>)
			: Array.isArray(payload)
				? payload
				: [];

	const normalized = raw
		.map((entry) => normalizeMarketPrice(entry ?? {}))
		.filter((item): item is MarketPrice => Boolean(item));

	const requestedSymbols = symbols.length > 0 ? symbols : SUPPORTED_MARKETS;

	return requestedSymbols.map((symbol) => {
		const fallbackPrice: MarketPrice = {
			symbol,
			price: Number.NaN,
			change24h: null,
			source: "cache",
			timestamp: new Date(0).toISOString(),
		};

		return normalized.find((price) => price.symbol === symbol) ?? fallbackPrice;
	});
}

async function requestMarketPrices(symbols: readonly MarketSymbol[]) {
	const data = await orpc.trading.getCryptoPrices.call({
		symbols: [...symbols],
	});
	return normalizeMarketPrices({ prices: data.prices }, symbols);
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

export async function prefetchMarketPrices(
	queryClient: QueryClient,
	symbols: readonly MarketSymbol[] = SUPPORTED_MARKETS,
) {
	return queryClient.ensureQueryData(marketPricesQueryOptions(symbols));
}

export function createMarketPriceUpdater(queryClient: QueryClient) {
	return (
		payload: MarketPricesResponse,
		symbols: readonly MarketSymbol[] = SUPPORTED_MARKETS,
	) => {
		const normalized = normalizeMarketPrices(payload, symbols);
		queryClient.setQueryData(MARKET_QUERY_KEYS.prices(symbols), normalized);
		return normalized;
	};
}

function normalizePortfolioHistory(
	payload: PortfolioHistoryResponse,
): PortfolioHistoryResult {
	// Handle new response format with { history, resolution }
	const isNewFormat = payload && typeof payload === "object" && !Array.isArray(payload) && "resolution" in payload;
	
	const raw: unknown = isNewFormat
		? (payload as PortfolioHistoryResult).history
		: payload && typeof payload === "object" && !Array.isArray(payload)
			? payload.history
			: payload;
	
	const resolution: DownsampleResolution = isNewFormat
		? (payload as PortfolioHistoryResult).resolution
		: "1m"; // Default fallback

	if (!Array.isArray(raw)) {
		return { history: [], resolution };
	}

	const entries: PortfolioHistoryEntry[] = [];

	for (const entry of raw) {
		if (!entry || typeof entry !== "object") continue;
		const record = entry as Record<string, unknown>;
		const id = typeof record.id === "string" ? record.id : null;
		const modelId =
			typeof record.modelId === "string" ? record.modelId : null;
		const netPortfolio =
			typeof record.netPortfolio === "string" ? record.netPortfolio : null;
		const createdAt =
			typeof record.createdAt === "string" ? record.createdAt : null;
		const updatedAt =
			typeof record.updatedAt === "string" ? record.updatedAt : null;
		const model =
			record.model && typeof record.model === "object" ? record.model : null;

		if (
			!id ||
			!modelId ||
			!netPortfolio ||
			!createdAt ||
			!updatedAt ||
			!model
		) {
			continue;
		}

		const modelRecord = model as Record<string, unknown>;
		const variant = typeof modelRecord.variant === "string" && isValidVariantId(modelRecord.variant)
				? modelRecord.variant
				: undefined;

		entries.push({
			id,
			modelId,
			netPortfolio,
			createdAt,
			updatedAt,
			model: {
				name:
					typeof modelRecord.name === "string"
						? modelRecord.name
						: "Unknown Model",
				variant,
				openRouterModelName:
					typeof modelRecord.openRouterModelName === "string"
						? modelRecord.openRouterModelName
						: "unknown-model",
			},
		});
	}

	return { history: entries, resolution };
}

async function requestPortfolioHistory(variant?: VariantId): Promise<PortfolioHistoryResult> {
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

export async function prefetchPortfolioHistory(queryClient: QueryClient, variant?: VariantId) {
	return queryClient.ensureQueryData(portfolioHistoryQueryOptions(variant));
}

export function createPortfolioHistoryUpdater(queryClient: QueryClient) {
	return (payload: PortfolioHistoryResponse, variant?: string) => {
		const normalized = normalizePortfolioHistory(payload);
		queryClient.setQueryData(PORTFOLIO_QUERY_KEYS.history(variant), normalized);
		return normalized;
	};
}

export const MARKET_QUERIES = {
	prices: marketPricesQueryOptions,
	prefetchPrices: prefetchMarketPrices,
};

export function useMarketPrices(symbols: readonly MarketSymbol[] = SUPPORTED_MARKETS) {
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
	return data as VariantHistoryResponse;
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
