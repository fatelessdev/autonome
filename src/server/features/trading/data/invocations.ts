/**
 * Invocations (conversations) query.
 */

import { queryOptions } from "@tanstack/react-query";
import { CACHE_TIMING } from "@/core/shared/cache/cacheConfig";
import { refreshConversationEvents } from "@/server/features/trading/data/conversationsSnapshot.server";

/**
 * Fetch conversation invocations snapshot
 * Cache: 20 seconds
 */
export const invocationsQuery = () =>
	queryOptions({
		queryKey: ["invocations"],
		queryFn: refreshConversationEvents,
		staleTime: CACHE_TIMING.STANDARD,
		gcTime: 3 * CACHE_TIMING.SLOW,
	});
