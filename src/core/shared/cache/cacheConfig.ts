/**
 * Centralized Query Cache Configuration
 *
 * This module provides standardized cache timing values for TanStack Query.
 * Use these constants across all query definitions to ensure consistent
 * cache behavior throughout the application.
 */

/**
 * Cache timing tiers for different data freshness requirements.
 */
export const CACHE_TIMING = {
	/**
	 * Real-time data that should be refreshed frequently.
	 * Use for: positions, prices, live metrics
	 */
	REALTIME: {
		staleTime: 10_000, // 10 seconds
		gcTime: 2 * 60_000, // 2 minutes
		refetchInterval: 15_000, // 15 seconds
	},

	/**
	 * Standard data that updates periodically.
	 * Use for: trades, conversations, portfolio history
	 */
	STANDARD: {
		staleTime: 60_000, // 1 minute
		gcTime: 5 * 60_000, // 5 minutes
		refetchInterval: 60_000, // 1 minute
	},

	/**
	 * Slow-changing data that doesn't need frequent updates.
	 * Use for: analytics, leaderboard, model stats
	 */
	SLOW: {
		staleTime: 3 * 60_000, // 3 minutes
		gcTime: 15 * 60_000, // 15 minutes
		refetchInterval: 3 * 60_000, // 3 minutes
	},

	/**
	 * Static data that rarely changes.
	 * Use for: model list, variant configurations
	 */
	STATIC: {
		staleTime: Infinity,
		gcTime: Infinity,
		refetchInterval: false as const,
	},
} as const;

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
 * createQueryKey(QUERY_KEY_PREFIX.TRADING, "positions", { variant: "Situational" })
 * // => ["trading", "positions", { variant: "Situational" }]
 * ```
 */
export function createQueryKey(
	prefix: string,
	...parts: (string | number | Record<string, unknown>)[]
): readonly unknown[] {
	return [prefix, ...parts] as const;
}

export type CacheTiming = typeof CACHE_TIMING[keyof typeof CACHE_TIMING];
