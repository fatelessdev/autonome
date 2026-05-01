import { queryOptions } from "@tanstack/react-query";
import { CACHE_TIMING } from "@/core/shared/cache/cacheConfig";
import type { Account } from "../contracts/accounts";
import { getPortfolio } from "./portfolio";

/**
 * Get portfolio snapshot for an account
 * Cache: 10 seconds (frequently accessed, balance changes)
 * Retry: 3 attempts with exponential backoff
 */
export const portfolioQuery = (account: Account) =>
	queryOptions({
		queryKey: ["portfolio", account.id],
		queryFn: () => getPortfolio(account),
		staleTime: CACHE_TIMING.REALTIME,
		gcTime: CACHE_TIMING.SLOW,
		retry: 2,
		retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
	});
