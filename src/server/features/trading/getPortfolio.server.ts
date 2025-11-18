import { queryOptions } from "@tanstack/react-query";
import type { Account } from "./accounts";
import { getPortfolio } from "./getPortfolio";

/**
 * Get portfolio snapshot for an account
 * Cache: 10 seconds (frequently accessed, balance changes)
 * Retry: 3 attempts with exponential backoff
 */
export const portfolioQuery = (account: Account) =>
	queryOptions({
		queryKey: ["portfolio", account.id],
		queryFn: () => getPortfolio(account, { fallbackToSimulator: true }),
		staleTime: 10_000, // 10 seconds
		gcTime: 1 * 60_000,
		retry: 3,
		retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
	});
