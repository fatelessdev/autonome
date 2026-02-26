import { queryOptions } from "@tanstack/react-query";
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
		staleTime: 10_000, // 10 seconds
		gcTime: 1 * 60_000,
		retry: 3,
		retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
	});
