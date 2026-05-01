/**
 * Crypto price fetching via Alpaca market data snapshots.
 */

import { queryOptions } from "@tanstack/react-query";
import { CACHE_TIMING } from "@/core/shared/cache/cacheConfig";
import {
	toAlpacaSymbol,
	toCanonical,
} from "@/core/shared/markets/marketMetadata";
import { db } from "@/db";
import { models } from "@/db/schema";
import { getMarketDataProvider } from "@/server/providers/alpaca";

// ==========================================
// SHARED UTILITIES
// ==========================================

export const parseRequiredFiniteNumber = (
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

// ==========================================
// CRYPTO PRICES
// ==========================================

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

export const cryptoPricesQuery = (symbols: string[]) => {
	const normalized = symbols
		.map((symbol) => toCanonical(symbol).toUpperCase())
		.sort((a, b) => a.localeCompare(b));

	return queryOptions({
		queryKey: ["crypto-prices", ...normalized],
		queryFn: () => fetchCryptoPrices(normalized),
		staleTime: CACHE_TIMING.REALTIME,
		gcTime: CACHE_TIMING.STATIC,
	});
};
