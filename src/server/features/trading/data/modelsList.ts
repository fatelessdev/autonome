/**
 * Models list query — simple model ID/name listing.
 */

import { queryOptions } from "@tanstack/react-query";
import { asc } from "drizzle-orm";
import { CACHE_TIMING } from "@/core/shared/cache/cacheConfig";
import { db } from "@/db";
import { models } from "@/db/schema";

export function fetchModelsList() {
	return db
		.select({ id: models.id, name: models.name })
		.from(models)
		.orderBy(asc(models.name));
}

/**
 * Fetch all models (simple list)
 * Cache: 30 seconds (models rarely change)
 */
export const modelsListQuery = () =>
	queryOptions({
		queryKey: ["models", "simple-list"],
		queryFn: fetchModelsList,
		staleTime: CACHE_TIMING.STANDARD,
		gcTime: 5 * CACHE_TIMING.SLOW,
	});
