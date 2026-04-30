import { queryOptions } from "@tanstack/react-query";
import { CACHE_TIMING } from "@/core/shared/cache/cacheConfig";
import type { Account } from "../contracts/accounts";
import { getOpenPositions } from "./positions";

/**
 * Get open positions for an account
 * Cache: 15 seconds
 * Auto-refresh: Every 30 seconds
 */
export const openPositionsQuery = (account: Account) =>
	queryOptions({
		queryKey: ["open-positions", account.id],
		queryFn: () => getOpenPositions(account),
		staleTime: CACHE_TIMING.REALTIME,
		gcTime: CACHE_TIMING.STATIC,
		refetchInterval: CACHE_TIMING.STANDARD,
		retry: 2,
	});
