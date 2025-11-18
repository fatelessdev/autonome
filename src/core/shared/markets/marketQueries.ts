import { type QueryClient, queryOptions } from "@tanstack/react-query";

import { orpc } from "@/server/orpc/client";
import { SUPPORTED_MARKETS } from "./marketMetadata";

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
	model: {
		name: string;
		openRouterModelName: string;
	};
};

export type PortfolioHistoryResponse =
	| PortfolioHistoryEntry[]
	| {
			history?: PortfolioHistoryEntry[];
	  }
	| null
	| undefined;

const MARKET_ENDPOINTS = {
	prices: "/api/crypto-prices",
} as const;

const PORTFOLIO_ENDPOINT = "/api/portfolio-history";

const MARKET_QUERY_KEYS = {
	prices: (symbols: readonly MarketSymbol[]) =>
		["markets", "prices", [...symbols].sort().join(",")] as const,
} as const;

const PORTFOLIO_QUERY_KEYS = {
	history: () => ["portfolio", "history"] as const,
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
		staleTime: 30_000,
		gcTime: 5 * 60_000,
		refetchInterval: 30_000,
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
): PortfolioHistoryEntry[] {
	const raw: unknown =
		payload && typeof payload === "object" && !Array.isArray(payload)
			? payload.history
			: payload;

	if (!Array.isArray(raw)) {
		return [];
	}

	return raw
		.map((entry) => {
			if (!entry || typeof entry !== "object") return null;
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
				return null;
			}

			const modelRecord = model as Record<string, unknown>;
			return {
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
					openRouterModelName:
						typeof modelRecord.openRouterModelName === "string"
							? modelRecord.openRouterModelName
							: "unknown-model",
				},
			} satisfies PortfolioHistoryEntry;
		})
		.filter((entry): entry is PortfolioHistoryEntry => Boolean(entry));
}

async function requestPortfolioHistory() {
	const data = await orpc.trading.getPortfolioHistory.call({});
	// Transform the data to match the expected format
	const transformedData = data.map(entry => ({
		...entry,
		model: {
			name: entry.model?.name || "Unknown Model",
			openRouterModelName: entry.model?.openRouterModelName || "unknown-model"
		}
	}));
	return normalizePortfolioHistory({ history: transformedData });
}

export const portfolioHistoryQueryOptions = () =>
	queryOptions({
		queryKey: PORTFOLIO_QUERY_KEYS.history(),
		queryFn: requestPortfolioHistory,
		staleTime: 3 * 60_000,
		gcTime: 15 * 60_000,
		refetchInterval: 3 * 60_000,
	});

export async function prefetchPortfolioHistory(queryClient: QueryClient) {
	return queryClient.ensureQueryData(portfolioHistoryQueryOptions());
}

export function createPortfolioHistoryUpdater(queryClient: QueryClient) {
	return (payload: PortfolioHistoryResponse) => {
		const normalized = normalizePortfolioHistory(payload);
		queryClient.setQueryData(PORTFOLIO_QUERY_KEYS.history(), normalized);
		return normalized;
	};
}

export const MARKET_QUERIES = {
	prices: marketPricesQueryOptions,
	prefetchPrices: prefetchMarketPrices,
};

export const PORTFOLIO_QUERIES = {
	history: portfolioHistoryQueryOptions,
	prefetchHistory: prefetchPortfolioHistory,
};
