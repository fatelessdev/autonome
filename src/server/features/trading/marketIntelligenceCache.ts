/**
 * Market Intelligence Cache
 *
 * Provides a shared cache for market data across all model invocations.
 * This prevents rate limiting by fetching market data once per trading cycle
 * instead of once per model.
 *
 * Architecture:
 * - Single global cache instance (survives HMR via globalThis)
 * - TTL-based expiration (default 2 minutes)
 * - Thread-safe fetch deduplication via in-flight promise tracking
 * - Integrates TAAPI supplementary indicators for BTC/ETH
 */

import { getMarketSnapshots, formatMarketSnapshots, type MarketSnapshot } from "./marketData";
import { MARKETS } from "@/shared/markets/marketMetadata";
import { taapiClient, type TaapiPreFetchResult } from "@/server/integrations/taapi";
import { TAAPI_FREE_PLAN_SYMBOLS } from "@/server/integrations/taapi/types";

const CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes

interface CacheEntry {
	snapshots: MarketSnapshot[];
	formatted: string;
	taapiData: Map<string, TaapiPreFetchResult>;
	fetchedAt: number;
}

declare global {
	// eslint-disable-next-line no-var
	var __marketIntelligenceCache: CacheEntry | null | undefined;
	// eslint-disable-next-line no-var
	var __marketIntelligenceFetchPromise: Promise<CacheEntry> | null | undefined;
}

// Initialize global cache state
if (typeof globalThis.__marketIntelligenceCache === "undefined") {
	globalThis.__marketIntelligenceCache = null;
}
if (typeof globalThis.__marketIntelligenceFetchPromise === "undefined") {
	globalThis.__marketIntelligenceFetchPromise = null;
}

/**
 * Format TAAPI supplementary indicators for a symbol.
 * Returns formatted string section or empty string if no data.
 */
function formatTaapiIndicators(
	_symbol: string,
	data: TaapiPreFetchResult | undefined,
): string {
	if (!data) return "";

	const lines: string[] = [];
	lines.push(`**Supplementary Indicators (1h, via TAAPI)**`);

	if (data.bbands) {
		lines.push(
			`BBands(20): Upper=${data.bbands.valueUpperBand.toFixed(2)}, ` +
			`Mid=${data.bbands.valueMiddleBand.toFixed(2)}, ` +
			`Lower=${data.bbands.valueLowerBand.toFixed(2)}`
		);
	}

	if (data.adx) {
		const strength =
			data.adx.value >= 25 ? "strong trend" :
			data.adx.value >= 20 ? "moderate trend" : "weak/no trend";
		lines.push(`ADX(14): ${data.adx.value.toFixed(1)} (${strength})`);
	}

	if (data.supertrend) {
		lines.push(
			`Supertrend(10): ${data.supertrend.value.toFixed(2)} → ${data.supertrend.valueAdvice.toUpperCase()}`
		);
	}

	// If no indicators were added, return empty
	if (lines.length === 1) return "";

	return lines.join("\n");
}

/**
 * Get cached market intelligence, fetching fresh data if cache is stale.
 * Multiple concurrent calls will share the same in-flight fetch.
 */
export async function getSharedMarketIntelligence(): Promise<{
	snapshots: MarketSnapshot[];
	formatted: string;
}> {
	const now = Date.now();
	const cached = globalThis.__marketIntelligenceCache;

	// Return cached data if still valid
	if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
		return { snapshots: cached.snapshots, formatted: cached.formatted };
	}

	// If a fetch is already in progress, wait for it
	if (globalThis.__marketIntelligenceFetchPromise) {
		const result = await globalThis.__marketIntelligenceFetchPromise;
		return { snapshots: result.snapshots, formatted: result.formatted };
	}

	// Start a new fetch
	const fetchPromise = (async (): Promise<CacheEntry> => {
		const marketUniverse = Object.entries(MARKETS).map(([symbol, meta]) => ({
			symbol,
			marketId: meta.marketId,
		}));

		// Fetch market snapshots and TAAPI data in parallel
		const [snapshots, taapiData] = await Promise.all([
			getMarketSnapshots(marketUniverse),
			taapiClient.isConfigured()
				? taapiClient.preFetchMultipleAssets([...TAAPI_FREE_PLAN_SYMBOLS], "1h")
				: Promise.resolve(new Map<string, TaapiPreFetchResult>()),
		]);

		// Build formatted output with TAAPI data integrated
		let formatted = formatMarketSnapshots(snapshots);

		// Append TAAPI data for BTC/ETH if available
		for (const symbol of TAAPI_FREE_PLAN_SYMBOLS) {
			const taapiIndicators = taapiData.get(symbol);
			if (taapiIndicators) {
				const taapiSection = formatTaapiIndicators(symbol, taapiIndicators);
				if (taapiSection) {
					// Insert TAAPI section after the symbol's market data header
					const marker = `### ${symbol} MARKET DATA`;
					const markerIndex = formatted.indexOf(marker);
					if (markerIndex !== -1) {
						// Find the end of the first line (after the header)
						const lineEnd = formatted.indexOf("\n", markerIndex);
						if (lineEnd !== -1) {
							// Insert TAAPI section before the series data
							const higherTfMarker = "**Higher timeframe (4h";
							const higherTfIndex = formatted.indexOf(higherTfMarker, markerIndex);
							if (higherTfIndex !== -1) {
								formatted =
									formatted.slice(0, higherTfIndex) +
									taapiSection +
									"\n" +
									formatted.slice(higherTfIndex);
							}
						}
					}
				}
			}
		}

		const entry: CacheEntry = {
			snapshots,
			formatted,
			taapiData,
			fetchedAt: Date.now(),
		};

		globalThis.__marketIntelligenceCache = entry;
		return entry;
	})();

	globalThis.__marketIntelligenceFetchPromise = fetchPromise;

	try {
		const result = await fetchPromise;
		return { snapshots: result.snapshots, formatted: result.formatted };
	} finally {
		// Clear the in-flight promise once resolved
		globalThis.__marketIntelligenceFetchPromise = null;
	}
}

/**
 * Invalidate the cache, forcing a fresh fetch on next access.
 * Useful after a trading cycle completes.
 */
export function invalidateMarketIntelligenceCache(): void {
	globalThis.__marketIntelligenceCache = null;
}

/**
 * Get cache status for debugging
 */
export function getMarketIntelligenceCacheStatus(): {
	isCached: boolean;
	ageMs: number | null;
	isFetching: boolean;
} {
	const cached = globalThis.__marketIntelligenceCache;
	return {
		isCached: cached !== null,
		ageMs: cached ? Date.now() - cached.fetchedAt : null,
		isFetching: globalThis.__marketIntelligenceFetchPromise !== null,
	};
}
