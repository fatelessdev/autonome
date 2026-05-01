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
 * - Integrates Binance OI data for all traded crypto assets
 * - Returns structured data only; formatting is handled by promptBuilder
 */

import { CACHE_TIMING } from "@/core/shared/cache/cacheConfig";
import { MARKETS } from "@/core/shared/markets/marketMetadata";
import {
	fetchAllOpenInterest,
	type OpenInterestMap,
} from "@/server/integrations/binance-oi";
import {
	type TaapiPreFetchResult,
	taapiClient,
} from "@/server/integrations/taapi";
import { TAAPI_FREE_PLAN_SYMBOLS } from "@/server/integrations/taapi/types";
import { getMarketSnapshots, type MarketSnapshot } from "./marketData";

const CACHE_TTL_MS = CACHE_TIMING.MARKET; // 2 minutes (market intelligence tier)
const FETCH_TIMEOUT_MS = 60_000; // 1 minute timeout for entire fetch operation

interface CacheEntry {
	snapshots: MarketSnapshot[];
	taapiData: Map<string, TaapiPreFetchResult>;
	oiData: OpenInterestMap;
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
 *
 * Returns structured data only — formatting is handled by promptBuilder.
 *
 * Credentials are required for the first call (to initialize the shared
 * Alpaca market data provider). Subsequent calls within the TTL window
 * return cached data without needing credentials again.
 */
export async function getSharedMarketIntelligence(credentials: {
	alpacaApiKey: string;
	alpacaApiSecret: string;
}): Promise<{
	snapshots: MarketSnapshot[];
	taapiData: Map<string, TaapiPreFetchResult>;
	oiData: OpenInterestMap;
}> {
	const now = Date.now();
	const cached = globalThis.__marketIntelligenceCache;

	// Return cached data if still valid
	if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
		return {
			snapshots: cached.snapshots,
			taapiData: cached.taapiData,
			oiData: cached.oiData,
		};
	}

	// If a fetch is already in progress, wait for it
	if (globalThis.__marketIntelligenceFetchPromise) {
		const result = await globalThis.__marketIntelligenceFetchPromise;
		return {
			snapshots: result.snapshots,
			taapiData: result.taapiData,
			oiData: result.oiData,
		};
	}

	// Start a new fetch
	const fetchPromise = (async (): Promise<CacheEntry> => {
		const marketUniverse = Object.entries(MARKETS).map(([canonical, meta]) => ({
			symbol: canonical,
			alpacaSymbol: meta.symbol,
		}));

		// Fetch market snapshots, TAAPI data, and OI data in parallel
		const [snapshots, taapiData, oiData] = await Promise.all([
			getMarketSnapshots(marketUniverse, credentials),
			taapiClient.isConfigured()
				? taapiClient.preFetchMultipleAssets([...TAAPI_FREE_PLAN_SYMBOLS], "1h")
				: Promise.resolve(new Map<string, TaapiPreFetchResult>()),
			fetchAllOpenInterest().catch((error) => {
				console.error(
					"[MarketIntelligenceCache] OI fetch failed, degrading gracefully:",
					error instanceof Error ? error.message : error,
				);
				return new Map() as OpenInterestMap;
			}),
		]);

		const entry: CacheEntry = {
			snapshots,
			taapiData,
			oiData,
			fetchedAt: Date.now(),
		};

		globalThis.__marketIntelligenceCache = entry;
		return entry;
	})();

	// Wrap with timeout to ensure fetch always settles
	const timeoutPromise = new Promise<never>((_, reject) => {
		setTimeout(
			() =>
				reject(
					new Error("Market intelligence fetch timed out after 60 seconds"),
				),
			FETCH_TIMEOUT_MS,
		);
	});

	const timedFetchPromise = Promise.race([fetchPromise, timeoutPromise]);
	globalThis.__marketIntelligenceFetchPromise = timedFetchPromise;

	try {
		const result = await timedFetchPromise;
		return {
			snapshots: result.snapshots,
			taapiData: result.taapiData,
			oiData: result.oiData,
		};
	} finally {
		// Clear the in-flight promise once resolved OR rejected (including timeout)
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
 * Get the current cached market intelligence data without triggering a fetch.
 * Returns null if cache is empty or expired.
 * Used by the diary service to access cycle-level market data for MarketState writes.
 */
export function getCachedMarketIntelligence(): {
	snapshots: MarketSnapshot[];
	taapiData: Map<string, TaapiPreFetchResult>;
	oiData: OpenInterestMap;
} | null {
	const cached = globalThis.__marketIntelligenceCache;
	if (!cached) return null;

	return {
		snapshots: cached.snapshots,
		taapiData: cached.taapiData,
		oiData: cached.oiData,
	};
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
