import type { Account } from "./accounts";
import { closePosition } from "./closePosition";

/**
 * Close one or more positions
 * This is a mutation function - use with useMutation hook
 * Hooks with cache invalidation will be added in a later phase
 */
export const closePositionMutation = (params: {
	account: Account;
	symbols: string[];
}) => {
	return closePosition(params.account, params.symbols);
};
