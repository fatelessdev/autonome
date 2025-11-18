import { queryOptions } from "@tanstack/react-query";
import type { Account } from "./accounts";
import { getOpenPositions } from "./openPositions";

/**
 * Get open positions for an account
 * Cache: 15 seconds
 * Auto-refresh: Every 30 seconds
 */
export const openPositionsQuery = (account: Account) =>
	queryOptions({
		queryKey: ["open-positions", account.id],
		queryFn: () =>
			getOpenPositions(account.apiKey, account.accountIndex, account.id, {
				fallbackToSimulator: true,
			}),
		staleTime: 15_000, // 15 seconds
		gcTime: 2 * 60_000,
		refetchInterval: 30_000, // Auto-refresh every 30 seconds
		retry: 2,
	});
