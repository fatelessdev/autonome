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
 */

import { getMarketSnapshots, formatMarketSnapshots, type MarketSnapshot } from "./marketData";
import { MARKETS } from "@/shared/markets/marketMetadata";

const CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes

interface CacheEntry {
	snapshots: MarketSnapshot[];
	formatted: string;
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

		const snapshots = await getMarketSnapshots(marketUniverse);
		const formatted = formatMarketSnapshots(snapshots);

		const entry: CacheEntry = {
			snapshots,
			formatted,
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
