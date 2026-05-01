/**
 * Portfolio history query — fetches and downsamples portfolio snapshots.
 */

import { queryOptions } from "@tanstack/react-query";
import { CACHE_TIMING } from "@/core/shared/cache/cacheConfig";
import {
	type DownsampleResolution,
	type DownsampleResult,
	downsampleForChart,
	getPortfolioHistoryWithResolution,
} from "@/server/features/portfolio/retentionService";

// ==========================================
// TYPES
// ==========================================

export type { DownsampleResolution };

export type PortfolioHistoryOptions = {
	variant?: string;
	startDate?: Date;
	endDate?: Date;
	/** Ignored - resolution is now auto-detected from time range */
	maxPoints?: number;
	/** Force a specific resolution (auto-detected if not provided) */
	resolution?: DownsampleResolution;
};

export type PortfolioHistoryResult = {
	history: DownsampleResult["entries"];
	resolution: DownsampleResolution;
};

// ==========================================
// QUERY
// ==========================================

export async function fetchPortfolioHistory(
	options?: PortfolioHistoryOptions,
): Promise<PortfolioHistoryResult> {
	const isAggregateMode = !options?.variant;

	const entries = await getPortfolioHistoryWithResolution({
		variant: options?.variant,
		startDate: options?.startDate,
		endDate: options?.endDate,
		maxPoints: undefined,
	});

	const result = downsampleForChart(
		entries,
		options?.resolution,
		isAggregateMode,
	);

	return {
		history: result.entries,
		resolution: result.resolution,
	};
}

/**
 * Fetch portfolio history for all models
 * Cache: 1 minute (updated every minute via scheduler)
 */
export const portfolioHistoryQuery = () =>
	queryOptions({
		queryKey: ["portfolio-history"],
		queryFn: () => fetchPortfolioHistory(),
		staleTime: CACHE_TIMING.SLOW,
		gcTime: 10 * CACHE_TIMING.SLOW,
	});
