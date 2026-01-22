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

// ==================== Retention Configuration ====================

/**
 * Retention thresholds - controls data pruning and aggregation timing.
 * All values in milliseconds.
 */
export const RETENTION_CONFIG = {
	/** Keep raw 1-minute data for this duration */
	RAW_DATA_RETENTION_MS: 7 * 24 * 60 * 60 * 1000, // 7 days
	/** After this, aggregate to daily buckets */
	HOURLY_TO_DAILY_MS: 30 * 24 * 60 * 60 * 1000, // 30 days
} as const;

// ==================== Downsampling Configuration ====================

/**
 * Time-based downsampling resolution tiers for chart rendering.
 * Resolution is auto-detected from data time range.
 * 
 * Time Range → Bucket Size → Approx Points (for 7 days of data)
 * - ≤24h      → 1 min      → 1,440 points
 * - ≤3d       → 5 min      → 864 points
 * - ≤7d       → 15 min     → 672 points
 * - ≤30d      → 1 hour     → 720 points
 * - >30d      → 4 hours    → ~180-360 points
 */
export const DOWNSAMPLE_CONFIG = {
	/** Time range thresholds (in milliseconds) */
	THRESHOLDS: {
		ONE_DAY: 24 * 60 * 60 * 1000,
		THREE_DAYS: 3 * 24 * 60 * 60 * 1000,
		SEVEN_DAYS: 7 * 24 * 60 * 60 * 1000,
		THIRTY_DAYS: 30 * 24 * 60 * 60 * 1000,
	},
	/** Resolution bucket sizes (in milliseconds) */
	RESOLUTIONS: {
		"1m": 60_000,
		"5m": 5 * 60_000,
		"15m": 15 * 60_000,
		"1h": 60 * 60_000,
		"4h": 4 * 60 * 60_000,
	},
} as const;

export type DownsampleResolution = keyof typeof DOWNSAMPLE_CONFIG.RESOLUTIONS;

// Resolution for aggregation export
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
	const sevenDaysAgo = new Date(now - RETENTION_CONFIG.RAW_DATA_RETENTION_MS);
	const thirtyDaysAgo = new Date(now - RETENTION_CONFIG.HOURLY_TO_DAILY_MS);

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
 * @param options.maxPoints - Maximum data points to return (optional, no limit if undefined)
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
	const { modelId, variant, startDate, endDate, maxPoints } = options ?? {};

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
		const query = db
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
			.orderBy(portfolioSize.createdAt);

		const entries = maxPoints ? await query.limit(maxPoints) : await query;

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
		...(maxPoints ? { limit: maxPoints } : {}),
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
 * Auto-detect appropriate resolution from data time range.
 */
function detectResolutionFromTimeRange(startMs: number, endMs: number): DownsampleResolution {
	const rangeMs = endMs - startMs;
	const { THRESHOLDS } = DOWNSAMPLE_CONFIG;
	
	if (rangeMs <= THRESHOLDS.ONE_DAY) return "1m";           // ≤1 day: 1-minute buckets
	if (rangeMs <= THRESHOLDS.THREE_DAYS) return "5m";        // ≤3 days: 5-minute buckets
	if (rangeMs <= THRESHOLDS.SEVEN_DAYS) return "15m";       // ≤7 days: 15-minute buckets
	if (rangeMs <= THRESHOLDS.THIRTY_DAYS) return "1h";       // ≤30 days: 1-hour buckets
	return "4h";                                               // >30 days: 4-hour buckets
}

type PortfolioEntry = {
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
};

/**
 * Time-based downsampling for chart rendering.
 * Groups data into time buckets and uses the LAST value per model per bucket.
 * 
 * This is similar to how OHLC charts use the "close" price - we want the value
 * at the END of each time bucket, not the average. This ensures:
 * 1. Chart lines accurately show portfolio progression over time
 * 2. Legend values match the actual current portfolio values
 * 3. No data loss from averaging that could hide gains/losses
 * 
 * After bucketing, appends the absolute latest entry per model to ensure the
 * chart always ends at the current portfolio value (not a stale bucket value).
 * 
 * @param data - Raw portfolio entries sorted by createdAt ascending
 * @param resolution - Optional forced resolution, auto-detected if not provided
 * @param averageAcrossVariants - If true, average the last values across all variants per model name (for aggregate view)
 * @returns Object containing downsampled entries and the resolution used
 */
export type DownsampleResult = {
	entries: PortfolioEntry[];
	resolution: DownsampleResolution;
};

export function downsampleForChart(
	data: PortfolioEntry[],
	resolution?: DownsampleResolution,
	averageAcrossVariants = false,
): DownsampleResult {
	if (data.length === 0) return { entries: [], resolution: resolution ?? "1m" };
	if (data.length === 1) return { entries: data, resolution: resolution ?? "1m" };

	// Parse timestamps and sort
	const withTimestamps = data
		.map((entry) => ({
			entry,
			timestamp: new Date(entry.createdAt).getTime(),
		}))
		.filter((item) => Number.isFinite(item.timestamp))
		.sort((a, b) => a.timestamp - b.timestamp);

	if (withTimestamps.length === 0) return { entries: [], resolution: resolution ?? "1m" };

	const startMs = withTimestamps[0]!.timestamp;
	const endMs = withTimestamps[withTimestamps.length - 1]!.timestamp;

	// Auto-detect resolution if not provided
	const detectedResolution = resolution ?? detectResolutionFromTimeRange(startMs, endMs);
	const bucketSizeMs = DOWNSAMPLE_CONFIG.RESOLUTIONS[detectedResolution];

	// Track the absolute latest entry per model (before bucketing)
	// For aggregate mode, track latest value per variant to average accurately
	type LatestVariant = { value: number; timestamp: number };
	const latestPerModel = new Map<
		string,
		{
			representative: PortfolioEntry;
			timestamp: number;
			variantValues: Map<string, LatestVariant>;
		}
	>();
	for (const { entry, timestamp } of withTimestamps) {
		const modelKey = entry.model.name;
		const value = Number(entry.netPortfolio);
		if (!Number.isFinite(value)) continue;

		const existing = latestPerModel.get(modelKey);
		if (!existing) {
			const variantValues = new Map<string, LatestVariant>();
			variantValues.set(entry.modelId, { value, timestamp });
			latestPerModel.set(modelKey, {
				representative: entry,
				timestamp,
				variantValues,
			});
			continue;
		}

		// Update representative if this entry is newer
		if (timestamp > existing.timestamp) {
			existing.representative = entry;
			existing.timestamp = timestamp;
		}

		// Track latest per variant
		const prevVariant = existing.variantValues.get(entry.modelId);
		if (!prevVariant || timestamp > prevVariant.timestamp) {
			existing.variantValues.set(entry.modelId, { value, timestamp });
		}
	}

	// Group entries into time buckets
	// For single variant: Key by modelId, track last value
	// For aggregate: Key by model name, collect last values from each variant to average
	type BucketData = {
		lastEntry: PortfolioEntry;
		lastValue: number;
		lastTimestamp: number;
		// For aggregate mode: track last value per variant (modelId)
		variantValues: Map<string, number>;
	};
	const buckets = new Map<number, Map<string, BucketData>>();

	for (const { entry, timestamp } of withTimestamps) {
		const bucketStart = Math.floor(timestamp / bucketSizeMs) * bucketSizeMs;
		
		// Model key: model name (for grouping display)
		const modelKey = entry.model.name;

		if (!buckets.has(bucketStart)) {
			buckets.set(bucketStart, new Map());
		}
		const bucketModels = buckets.get(bucketStart)!;

		const value = Number(entry.netPortfolio);
		if (!Number.isFinite(value)) continue;

		if (!bucketModels.has(modelKey)) {
			const variantValues = new Map<string, number>();
			variantValues.set(entry.modelId, value);
			bucketModels.set(modelKey, { lastEntry: entry, lastValue: value, lastTimestamp: timestamp, variantValues });
		} else {
			const existing = bucketModels.get(modelKey)!;
			existing.lastEntry = entry;
			existing.lastValue = value;
			existing.lastTimestamp = timestamp;
			// Track each variant's last value separately for aggregate mode
			existing.variantValues.set(entry.modelId, value);
		}
	}

	// Build output: one entry per model per bucket
	const result: PortfolioEntry[] = [];
	const sortedBuckets = Array.from(buckets.keys()).sort((a, b) => a - b);

	// Track the last bucket timestamp per model (to avoid duplicates when appending latest)
	const lastBucketTimePerModel = new Map<string, number>();

	for (const bucketStart of sortedBuckets) {
		const bucketModels = buckets.get(bucketStart)!;
		const bucketTime = new Date(bucketStart).toISOString();

		for (const [modelKey, { lastEntry, lastValue, variantValues }] of bucketModels) {
			let outputValue: number;
			
			if (averageAcrossVariants && variantValues.size > 1) {
				// Aggregate mode: average the last values from each variant
				const values = Array.from(variantValues.values());
				outputValue = values.reduce((sum, v) => sum + v, 0) / values.length;
			} else {
				// Single variant mode: use the last value directly (like OHLC close price)
				outputValue = lastValue;
			}
			
			result.push({
				id: lastEntry.id,
				modelId: lastEntry.modelId,
				netPortfolio: outputValue.toFixed(2),
				createdAt: bucketTime,
				updatedAt: lastEntry.updatedAt,
				model: lastEntry.model,
			});

			lastBucketTimePerModel.set(modelKey, bucketStart);
		}
	}

	// Append the absolute latest entry per model if it's newer than the last bucket
	// This ensures the chart always ends at the actual current (and properly averaged) value
	for (const [modelKey, latest] of latestPerModel) {
		const lastBucketTime = lastBucketTimePerModel.get(modelKey) ?? 0;
		const latestTimestamp = latest.timestamp;
		if (latestTimestamp <= lastBucketTime) continue;

		let latestValue: number;
		if (averageAcrossVariants && latest.variantValues.size > 1) {
			const values = Array.from(latest.variantValues.values()).map((v) => v.value);
			latestValue = values.reduce((sum, v) => sum + v, 0) / values.length;
		} else {
			latestValue = latest.variantValues.values().next().value?.value ?? Number(latest.representative.netPortfolio);
		}

		result.push({
			id: latest.representative.id,
			modelId: latest.representative.modelId,
			netPortfolio: latestValue.toFixed(2),
			createdAt: new Date(latestTimestamp).toISOString(),
			updatedAt: latest.representative.updatedAt,
			model: latest.representative.model,
		});
	}

	// Re-sort after appending latest entries
	result.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

	return { entries: result, resolution: detectedResolution };
}
