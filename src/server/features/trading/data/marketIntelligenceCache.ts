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
import {
	formatMarketSnapshots,
	getMarketSnapshots,
	type MarketSnapshot,
} from "./marketData";

const CACHE_TTL_MS = CACHE_TIMING.MARKET; // 2 minutes (market intelligence tier)
const FETCH_TIMEOUT_MS = 60_000; // 1 minute timeout for entire fetch operation

interface CacheEntry {
	snapshots: MarketSnapshot[];
	formatted: string;
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
 * Format TAAPI supplementary indicators for a symbol.
 * Returns formatted string section or empty string if no data.
 */
function formatTaapiIndicators(
	_symbol: string,
	data: TaapiPreFetchResult | undefined,
	currentPrice?: number,
): string {
	if (!data) return "";

	const lines: string[] = [];
	lines.push(`**Supplementary Indicators (1h, via TAAPI)**`);

	if (data.bbands) {
		lines.push(
			`BBands(20): Upper=${data.bbands.valueUpperBand.toFixed(2)}, ` +
				`Mid=${data.bbands.valueMiddleBand.toFixed(2)}, ` +
				`Lower=${data.bbands.valueLowerBand.toFixed(2)}`,
		);
	}

	if (data.adx) {
		const strength =
			data.adx.value >= 25
				? "strong trend"
				: data.adx.value >= 20
					? "moderate trend"
					: "weak/no trend";
		lines.push(`ADX(14): ${data.adx.value.toFixed(1)} (${strength})`);
	}

	if (data.supertrend) {
		lines.push(
			`Supertrend(10): ${data.supertrend.value.toFixed(2)} → ${data.supertrend.valueAdvice.toUpperCase()}`,
		);
	}

	// Ichimoku Cloud - key levels and cloud status
	if (data.ichimoku) {
		const ich = data.ichimoku;
		lines.push(
			`Ichimoku: Tenkan=${ich.conversion.toFixed(2)}, Kijun=${ich.base.toFixed(2)}`,
		);
		lines.push(
			`  Cloud: SpanA=${ich.spanA.toFixed(2)}, SpanB=${ich.spanB.toFixed(2)}`,
		);

		// Determine cloud status if we have current price
		if (currentPrice !== undefined && currentPrice !== null) {
			const cloudTop = Math.max(ich.spanA, ich.spanB);
			const cloudBottom = Math.min(ich.spanA, ich.spanB);

			let cloudStatus: string;
			if (currentPrice > cloudTop) {
				cloudStatus = "ABOVE CLOUD (Bullish)";
			} else if (currentPrice < cloudBottom) {
				cloudStatus = "BELOW CLOUD (Bearish)";
			} else {
				cloudStatus = "INSIDE CLOUD (Choppy/Neutral)";
			}
			lines.push(`  Cloud Status: ${cloudStatus}`);
		}
	}

	// VWAP - Volume Weighted Average Price
	if (data.vwap && data.vwap.value !== undefined) {
		let vwapStatus = "";
		if (currentPrice !== undefined && currentPrice !== null) {
			const diff = currentPrice - data.vwap.value;
			const diffPct = (diff / data.vwap.value) * 100;
			if (currentPrice > data.vwap.value) {
				vwapStatus = ` | Price > VWAP (+${diffPct.toFixed(2)}%, Bullish)`;
			} else {
				vwapStatus = ` | Price < VWAP (${diffPct.toFixed(2)}%, Bearish)`;
			}
		}
		lines.push(`VWAP: ${data.vwap.value.toFixed(2)}${vwapStatus}`);
	}

	// If no indicators were added, return empty
	if (lines.length === 1) return "";

	return lines.join("\n");
}

/**
 * Format open interest data for a symbol.
 * Returns formatted string section or empty string if no data.
 */
function formatOpenInterest(
	symbol: string,
	oiData: OpenInterestMap | undefined,
): string {
	if (!oiData) return "";

	const data = oiData.get(symbol);
	if (!data) return "";

	const lines: string[] = [];
	lines.push(`**Open Interest (via Binance Futures)**`);

	// Format OI value in human-readable form (contracts)
	const oiFormatted =
		data.openInterest >= 1_000_000
			? `${(data.openInterest / 1_000_000).toFixed(2)}M`
			: data.openInterest >= 1_000
				? `${(data.openInterest / 1_000).toFixed(2)}K`
				: data.openInterest.toFixed(2);

	// Format OI value in USD
	const oiUsdFormatted =
		data.openInterestValueUsd >= 1_000_000_000
			? `$${(data.openInterestValueUsd / 1_000_000_000).toFixed(2)}B`
			: data.openInterestValueUsd >= 1_000_000
				? `$${(data.openInterestValueUsd / 1_000_000).toFixed(2)}M`
				: `$${(data.openInterestValueUsd / 1_000).toFixed(2)}K`;

	lines.push(`OI: ${oiFormatted} contracts (${oiUsdFormatted})`);

	// Format change with direction indicator
	const changeSign = data.changePercent >= 0 ? "+" : "";
	lines.push(`OI 24h Change: ${changeSign}${data.changePercent.toFixed(2)}%`);

	return lines.join("\n");
}

/**
 * Get cached market intelligence, fetching fresh data if cache is stale.
 * Multiple concurrent calls will share the same in-flight fetch.
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
	formatted: string;
	taapiData: Map<string, TaapiPreFetchResult>;
	oiData: OpenInterestMap;
}> {
	const now = Date.now();
	const cached = globalThis.__marketIntelligenceCache;

	// Return cached data if still valid
	if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
		return {
			snapshots: cached.snapshots,
			formatted: cached.formatted,
			taapiData: cached.taapiData,
			oiData: cached.oiData,
		};
	}

	// If a fetch is already in progress, wait for it
	if (globalThis.__marketIntelligenceFetchPromise) {
		const result = await globalThis.__marketIntelligenceFetchPromise;
		return {
			snapshots: result.snapshots,
			formatted: result.formatted,
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

		// Build formatted output with TAAPI data integrated
		let formatted = formatMarketSnapshots(snapshots);

		// Build a price map from snapshots for TAAPI formatting
		const priceMap = new Map<string, number>();
		for (const snapshot of snapshots) {
			if (snapshot.latest.price && Number.isFinite(snapshot.latest.price)) {
				priceMap.set(snapshot.symbol, snapshot.latest.price);
			}
		}

		// Append TAAPI data for BTC/ETH if available
		for (const symbol of TAAPI_FREE_PLAN_SYMBOLS) {
			const taapiIndicators = taapiData.get(symbol);
			if (taapiIndicators) {
				const currentPrice = priceMap.get(symbol);
				const taapiSection = formatTaapiIndicators(
					symbol,
					taapiIndicators,
					currentPrice,
				);
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
							const higherTfIndex = formatted.indexOf(
								higherTfMarker,
								markerIndex,
							);
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

		// Append OI data for all symbols that have it
		if (oiData.size > 0) {
			for (const [symbol] of oiData) {
				const oiSection = formatOpenInterest(symbol, oiData);
				if (oiSection) {
					const marker = `### ${symbol} MARKET DATA`;
					const markerIndex = formatted.indexOf(marker);
					if (markerIndex !== -1) {
						// Insert OI section after TAAPI section (if present) or before series data
						const higherTfMarker = "**Higher timeframe (4h";
						const higherTfIndex = formatted.indexOf(
							higherTfMarker,
							markerIndex,
						);
						if (higherTfIndex !== -1) {
							formatted =
								formatted.slice(0, higherTfIndex) +
								oiSection +
								"\n" +
								formatted.slice(higherTfIndex);
						}
					}
				}
			}
		}

		const entry: CacheEntry = {
			snapshots,
			formatted,
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
			formatted: result.formatted,
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
