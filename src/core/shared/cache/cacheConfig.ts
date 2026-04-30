/**
 * Centralized Query Cache Configuration
 *
 * This module provides standardized cache timing values for TanStack Query.
 * Use these constants across all query definitions to ensure consistent
 * cache behavior throughout the application.
 */

/**
 * Cache timing tiers for different data freshness requirements.
 *
 * Use these constants as base timing values. For gcTime, multiply the
 * appropriate tier (e.g. `5 * CACHE_TIMING.SLOW` for a 5-minute gcTime).
 */
export const CACHE_TIMING = {
	/** 15 seconds — positions, prices, live metrics */
	REALTIME: 15_000,
	/** 30 seconds — trades, conversations, portfolio snapshots */
	STANDARD: 30_000,
	/** 60 seconds — portfolio history, analytics */
	SLOW: 60_000,
	/** 120 seconds — model list, variant configurations */
	STATIC: 120_000,
} as const;

/**
 * Trade cycle interval — how often the trade cycle workflow runs.
 * Used by tradeCycle.ts, dashboardQueries.ts, and alpaca-news/client.ts.
 */
export const TRADE_CYCLE_INTERVAL = 5 * 60 * 1000; // 5 minutes

/**
 * Query key prefixes for proper cache isolation.
 */
export const QUERY_KEY_PREFIX = {
	TRADING: "trading",
	PORTFOLIO: "portfolio",
	MODELS: "models",
	ANALYTICS: "analytics",
	VARIANTS: "variants",
	POSITIONS: "positions",
	TRADES: "trades",
	CONVERSATIONS: "conversations",
	PRICES: "prices",
} as const;

/**
 * Helper to create namespaced query keys.
 *
 * Usage:
 * ```ts
 * createQueryKey(QUERY_KEY_PREFIX.TRADING, "positions", { variant: "Trendsurfer" })
 * // => ["trading", "positions", { variant: "Trendsurfer" }]
 * ```
 */
export function createQueryKey(
	prefix: string,
	...parts: (string | number | Record<string, unknown>)[]
): readonly unknown[] {
	return [prefix, ...parts] as const;
}

/**
 * Union type of all cache timing tier values.
 */
export type CacheTimingTier = (typeof CACHE_TIMING)[keyof typeof CACHE_TIMING];
