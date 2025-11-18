import { queryOptions } from "@tanstack/react-query";
import { getMarketSnapshots } from "./marketData";

/**
 * Get market snapshots for multiple markets
 * Cache: 1 minute (expensive computation)
 * Background refresh: Every 5 minutes
 */
export const marketSnapshotsQuery = (
	markets: Array<{ symbol: string; marketId: number }>,
) => {
	const sortedSymbols = markets.map((m) => m.symbol).sort();

	return queryOptions({
		queryKey: ["market-snapshots", ...sortedSymbols],
		queryFn: () => getMarketSnapshots(markets),
		staleTime: 60_000, // 1 minute cache
		gcTime: 10 * 60_000,
		refetchInterval: 5 * 60_000, // Auto-refresh every 5 minutes
		refetchOnWindowFocus: false, // Don't refetch on tab focus (expensive)
	});
};

/**
 * Get snapshot for a single symbol
 * More efficient for individual queries
 */
export const symbolSnapshotQuery = (symbol: string, marketId: number) =>
	queryOptions({
		queryKey: ["market-snapshot", symbol],
		queryFn: async () => {
			const snapshots = await getMarketSnapshots([{ symbol, marketId }]);
			return snapshots[0];
		},
		staleTime: 60_000,
		gcTime: 10 * 60_000,
		refetchInterval: 5 * 60_000,
		refetchOnWindowFocus: false,
	});
