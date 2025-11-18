import type { Account } from "./accounts";
import { createPosition, type PositionRequest } from "./createPosition";

/**
 * Create one or more positions
 * This is a mutation function - use with useMutation hook
 * Hooks with cache invalidation will be added in a later phase
 */
export const createPositionMutation = (params: {
	account: Account;
	positions: PositionRequest[];
}) => {
	return createPosition(params.account, params.positions);
};
