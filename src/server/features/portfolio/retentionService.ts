/**
 * Portfolio Data Retention & Aggregation Service
 *
 * Implements a tiered data retention policy to prevent unbounded growth:
 * - Raw data: Last 7 days (1-minute resolution)
 * - Hourly aggregates: 7-30 days
 * - Daily aggregates: 30+ days
 *
 * CRITICAL: Always preserves the first snapshot per model (initial capital baseline)
 * to ensure graphs start from the correct origin point.
 */

import { randomUUID } from "node:crypto";
import { and, eq, gte, lt, sql, min, avg, count } from "drizzle-orm";
import { db } from "@/db";
import { portfolioSize, models, type Variant } from "@/db/schema";

// Retention thresholds
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

// Resolution for aggregation
export type Resolution = "raw" | "hourly" | "daily";

/**
 * Run the full retention policy:
 * 1. Aggregate raw data older than 7 days into hourly buckets
 * 2. Aggregate hourly data older than 30 days into daily buckets
 * 3. Delete raw data that has been aggregated (except first snapshot per model)
 */
export async function runRetentionPolicy(): Promise<{
	hourlyAggregatesCreated: number;
	dailyAggregatesCreated: number;
	rawRecordsDeleted: number;
}> {
	const now = Date.now();
	const sevenDaysAgo = new Date(now - SEVEN_DAYS_MS);
	const thirtyDaysAgo = new Date(now - THIRTY_DAYS_MS);

	// Step 1: Get first snapshot per model (must preserve these)
	const firstSnapshots = await getFirstSnapshotPerModel();
	const preservedIds = new Set(firstSnapshots.map((s) => s.id));

	// Step 2: Aggregate 7-30 day old raw data into hourly buckets
	const hourlyAggregatesCreated = await aggregateToHourly(sevenDaysAgo, thirtyDaysAgo, preservedIds);

	// Step 3: Aggregate 30+ day old data into daily buckets
	const dailyAggregatesCreated = await aggregateToDaily(thirtyDaysAgo, preservedIds);

	// Step 4: Delete aggregated raw records (except preserved first snapshots)
	const rawRecordsDeleted = await deleteAggregatedRawRecords(sevenDaysAgo, preservedIds);

	return {
		hourlyAggregatesCreated,
		dailyAggregatesCreated,
		rawRecordsDeleted,
	};
}

/**
 * Get the first (oldest) snapshot for each model.
 * These are never deleted to ensure graphs start from origin.
 */
async function getFirstSnapshotPerModel(): Promise<Array<{ id: string; modelId: string; createdAt: Date }>> {
	// Get minimum createdAt per model
	const minDates = await db
		.select({
			modelId: portfolioSize.modelId,
			minCreatedAt: min(portfolioSize.createdAt).as("minCreatedAt"),
		})
		.from(portfolioSize)
		.groupBy(portfolioSize.modelId);

	if (minDates.length === 0) return [];

	// Fetch the actual records for those dates
	const results: Array<{ id: string; modelId: string; createdAt: Date }> = [];

	for (const { modelId, minCreatedAt } of minDates) {
		if (!minCreatedAt) continue;

		const [firstSnapshot] = await db
			.select({ id: portfolioSize.id, modelId: portfolioSize.modelId, createdAt: portfolioSize.createdAt })
			.from(portfolioSize)
			.where(and(eq(portfolioSize.modelId, modelId), eq(portfolioSize.createdAt, minCreatedAt)))
			.limit(1);

		if (firstSnapshot) {
			results.push(firstSnapshot);
		}
	}

	return results;
}

/**
 * Aggregate raw snapshots from 7-30 days ago into hourly buckets.
 * Creates one aggregate record per model per hour.
 */
async function aggregateToHourly(
	startDate: Date,
	endDate: Date,
	_preservedIds: Set<string>,
): Promise<number> {
	// Get hourly aggregates using database-level grouping
	const hourlyAggregates = await db
		.select({
			modelId: portfolioSize.modelId,
			hourBucket: sql<string>`date_trunc('hour', ${portfolioSize.createdAt})`.as("hourBucket"),
			avgPortfolio: avg(portfolioSize.netPortfolio).as("avgPortfolio"),
			recordCount: count().as("recordCount"),
		})
		.from(portfolioSize)
		.where(and(gte(portfolioSize.createdAt, endDate), lt(portfolioSize.createdAt, startDate)))
		.groupBy(portfolioSize.modelId, sql`date_trunc('hour', ${portfolioSize.createdAt})`);

	if (hourlyAggregates.length === 0) return 0;

	// Check which hourly buckets already have aggregated records
	// (to avoid duplicate aggregation on repeated runs)
	let created = 0;
	for (const agg of hourlyAggregates) {
		if (!agg.avgPortfolio || !agg.hourBucket) continue;

		const bucketTime = new Date(agg.hourBucket);

		// Check if aggregate already exists for this hour
		const existing = await db
			.select({ id: portfolioSize.id })
			.from(portfolioSize)
			.where(
				and(
					eq(portfolioSize.modelId, agg.modelId),
					eq(portfolioSize.createdAt, bucketTime),
				),
			)
			.limit(1);

		if (existing.length > 0) continue;

		// Insert the hourly aggregate
		await db.insert(portfolioSize).values({
			id: randomUUID(),
			modelId: agg.modelId,
			netPortfolio: String(Math.round(Number(agg.avgPortfolio) * 100) / 100),
			createdAt: bucketTime,
			updatedAt: new Date(),
		});
		created++;
	}

	return created;
}

/**
 * Aggregate data older than 30 days into daily buckets.
 */
async function aggregateToDaily(cutoffDate: Date, _preservedIds: Set<string>): Promise<number> {
	const dailyAggregates = await db
		.select({
			modelId: portfolioSize.modelId,
			dayBucket: sql<string>`date_trunc('day', ${portfolioSize.createdAt})`.as("dayBucket"),
			avgPortfolio: avg(portfolioSize.netPortfolio).as("avgPortfolio"),
			recordCount: count().as("recordCount"),
		})
		.from(portfolioSize)
		.where(lt(portfolioSize.createdAt, cutoffDate))
		.groupBy(portfolioSize.modelId, sql`date_trunc('day', ${portfolioSize.createdAt})`);

	if (dailyAggregates.length === 0) return 0;

	let created = 0;
	for (const agg of dailyAggregates) {
		if (!agg.avgPortfolio || !agg.dayBucket) continue;

		const bucketTime = new Date(agg.dayBucket);

		// Only create if we have multiple records to aggregate (skip if already aggregated to 1)
		if (Number(agg.recordCount) <= 1) continue;

		// Check if daily aggregate already exists
		const existing = await db
			.select({ id: portfolioSize.id })
			.from(portfolioSize)
			.where(
				and(
					eq(portfolioSize.modelId, agg.modelId),
					eq(portfolioSize.createdAt, bucketTime),
				),
			)
			.limit(1);

		if (existing.length > 0) continue;

		await db.insert(portfolioSize).values({
			id: randomUUID(),
			modelId: agg.modelId,
			netPortfolio: String(Math.round(Number(agg.avgPortfolio) * 100) / 100),
			createdAt: bucketTime,
			updatedAt: new Date(),
		});
		created++;
	}

	return created;
}

/**
 * Delete raw records that have been aggregated.
 * Preserves:
 * - All data from the last 7 days
 * - First snapshot per model (origin point)
 * - Aggregated hourly/daily records
 */
async function deleteAggregatedRawRecords(cutoffDate: Date, preservedIds: Set<string>): Promise<number> {
	if (preservedIds.size === 0) {
		// If no preserved IDs, delete all old raw records
		await db
			.delete(portfolioSize)
			.where(lt(portfolioSize.createdAt, cutoffDate));

		// Drizzle doesn't return count directly, so we estimate
		return 0; // Return 0 since we can't get exact count
	}

	// Delete records older than cutoff, excluding preserved IDs
	// We need to be careful here to not delete aggregated records
	// So we only delete records that are NOT at hour/day boundaries
	const preservedIdArray = Array.from(preservedIds);

	// This is a bit tricky - we want to delete raw records but keep aggregates
	// Aggregates are at exact hour/day boundaries (minute=0, second=0)
	// Raw records have varying minute/second values

	await db.execute(sql`
		DELETE FROM "PortfolioSize"
		WHERE "createdAt" < ${cutoffDate}
		AND "id" NOT IN (${sql.join(preservedIdArray.map(id => sql`${id}`), sql`, `)})
		AND (
			EXTRACT(MINUTE FROM "createdAt") != 0
			OR EXTRACT(SECOND FROM "createdAt") != 0
		)
	`);

	return 0; // Can't get exact count from drizzle execute
}

/**
 * Get portfolio history with adaptive resolution based on data age.
 * - Last 7 days: raw data
 * - 7-30 days: hourly data
 * - 30+ days: daily data
 *
 * @param options.modelId - Filter by specific model (optional)
 * @param options.variant - Filter by variant (optional)
 * @param options.startDate - Start of time range (optional)
 * @param options.endDate - End of time range (optional)
 * @param options.maxPoints - Maximum data points to return (for client-side performance)
 */
export async function getPortfolioHistoryWithResolution(options?: {
	modelId?: string;
	variant?: string;
	startDate?: Date;
	endDate?: Date;
	maxPoints?: number;
}): Promise<
	Array<{
		id: string;
		modelId: string;
		netPortfolio: string;
		createdAt: string;
		updatedAt: string;
		model: {
			name: string;
			variant: string | undefined;
			openRouterModelName: string;
		};
	}>
> {
	const { modelId, variant, startDate, endDate, maxPoints = 2000 } = options ?? {};

	// Build where conditions
	const conditions = [];

	if (modelId) {
		conditions.push(eq(portfolioSize.modelId, modelId));
	}

	if (startDate) {
		conditions.push(gte(portfolioSize.createdAt, startDate));
	}

	if (endDate) {
		conditions.push(lt(portfolioSize.createdAt, endDate));
	}

	// If filtering by variant, we need to join with models
	if (variant) {
		// Cast variant string to the enum type
		const variantValue = variant as Variant;
		// Join with models to filter by variant
		const entries = await db
			.select({
				id: portfolioSize.id,
				modelId: portfolioSize.modelId,
				netPortfolio: portfolioSize.netPortfolio,
				createdAt: portfolioSize.createdAt,
				updatedAt: portfolioSize.updatedAt,
				modelName: models.name,
				modelVariant: models.variant,
				modelOpenRouterName: models.openRouterModelName,
			})
			.from(portfolioSize)
			.innerJoin(models, eq(portfolioSize.modelId, models.id))
			.where(
				conditions.length > 0
					? and(...conditions, eq(models.variant, variantValue))
					: eq(models.variant, variantValue),
			)
			.orderBy(portfolioSize.createdAt)
			.limit(maxPoints);

		return entries.map((entry) => ({
			id: entry.id,
			modelId: entry.modelId,
			netPortfolio: String(entry.netPortfolio),
			createdAt: entry.createdAt.toISOString(),
			updatedAt: entry.updatedAt.toISOString(),
			model: {
				name: entry.modelName ?? "Unknown Model",
				variant: entry.modelVariant ?? undefined,
				openRouterModelName: entry.modelOpenRouterName ?? "unknown-model",
			},
		}));
	}

	// No variant filter - use simpler query with model relation
	const entries = await db.query.portfolioSize.findMany({
		where: conditions.length > 0 ? and(...conditions) : undefined,
		with: {
			model: {
				columns: {
					name: true,
					variant: true,
					openRouterModelName: true,
				},
			},
		},
		orderBy: (row, { asc: ascHelper }) => ascHelper(row.createdAt),
		limit: maxPoints,
	});

	return entries.map((entry) => ({
		id: entry.id,
		modelId: entry.modelId,
		netPortfolio: String(entry.netPortfolio),
		createdAt: entry.createdAt.toISOString(),
		updatedAt: entry.updatedAt.toISOString(),
		model: {
			name: entry.model?.name ?? "Unknown Model",
			variant: entry.model?.variant ?? undefined,
			openRouterModelName: entry.model?.openRouterModelName ?? "unknown-model",
		},
	}));
}

/**
 * Downsample data points for chart rendering.
 * Uses adaptive intervals based on total data points:
 * - < 500 points: show all (1 min intervals)
 * - 500-2000 points: 5 min intervals
 * - 2000-5000 points: 15 min intervals
 * - 5000-10000 points: 1 hour intervals
 * - > 10000 points: 12 hour intervals
 */
export function downsampleForChart<T extends { createdAt: string }>(
	data: T[],
	targetPoints: number = 500,
): T[] {
	if (data.length <= targetPoints) {
		return data;
	}

	// Calculate the step size to achieve target points
	const step = Math.ceil(data.length / targetPoints);

	// Always include first and last points
	const result: T[] = [data[0]!];

	for (let i = step; i < data.length - 1; i += step) {
		result.push(data[i]!);
	}

	// Always include last point
	if (data.length > 1) {
		result.push(data[data.length - 1]!);
	}

	return result;
}
