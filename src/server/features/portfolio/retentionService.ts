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
import { and, avg, count, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { models, portfolioSize, type Variant } from "@/db/schema";
import {
	pruneDecisionDiary,
	pruneMarketState,
} from "@/server/db/tradingRepository";

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
	/** Keep DecisionDiary and MarketState entries for this duration */
	DIARY_RETENTION_MS: 30 * 24 * 60 * 60 * 1000, // 30 days
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

function requireString(
	value: string | null | undefined,
	context: string,
): string {
	if (!value) {
		throw new Error(`Missing required value for ${context}`);
	}
	return value;
}

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
	diaryEntriesPruned: number;
	marketStatesPruned: number;
}> {
	const now = Date.now();
	const sevenDaysAgo = new Date(now - RETENTION_CONFIG.RAW_DATA_RETENTION_MS);
	const thirtyDaysAgo = new Date(now - RETENTION_CONFIG.HOURLY_TO_DAILY_MS);
	const diaryCutoff = new Date(now - RETENTION_CONFIG.DIARY_RETENTION_MS);

	// Step 1: Get first snapshot per model (must preserve these)
	const firstSnapshots = await getFirstSnapshotPerModel();
	const preservedIds = new Set(firstSnapshots.map((s) => s.id));

	// Step 2: Aggregate 7-30 day old raw data into hourly buckets
	const hourlyAggregatesCreated = await aggregateToHourly(
		sevenDaysAgo,
		thirtyDaysAgo,
	);

	// Step 3: Aggregate 30+ day old data into daily buckets
	const dailyAggregatesCreated = await aggregateToDaily(thirtyDaysAgo);

	// Step 4: Delete aggregated raw records (except preserved first snapshots)
	const rawRecordsDeleted = await deleteAggregatedRawRecords(
		sevenDaysAgo,
		preservedIds,
	);

	// Step 5: Prune DecisionDiary and MarketState entries older than 30 days
	const [diaryEntriesPruned, marketStatesPruned] = await Promise.all([
		pruneDecisionDiary(diaryCutoff),
		pruneMarketState(diaryCutoff),
	]);

	return {
		hourlyAggregatesCreated,
		dailyAggregatesCreated,
		rawRecordsDeleted,
		diaryEntriesPruned,
		marketStatesPruned,
	};
}

/**
 * Get the first (oldest) snapshot for each model.
 * These are never deleted to ensure graphs start from origin.
 * Uses DISTINCT ON for a single DB call regardless of model count.
 */
async function getFirstSnapshotPerModel(): Promise<
	Array<{ id: string; modelId: string; createdAt: Date }>
> {
	const results = await db.execute(sql`
		SELECT DISTINCT ON ("modelId")
			"id",
			"modelId",
			"createdAt"
		FROM "PortfolioSize"
		ORDER BY "modelId", "createdAt" ASC
	`);

	return results.rows as Array<{
		id: string;
		modelId: string;
		createdAt: Date;
	}>;
}

/**
 * Aggregate raw snapshots into time-based buckets.
 * Creates one aggregate record per model per bucket.
 *
 * @param truncUnit - SQL date_trunc unit ('hour' or 'day')
 * @param filter - Drizzle WHERE condition for selecting records to aggregate
 * @param skipSingleRecords - If true, skip buckets with only 1 record (already "aggregated")
 */
async function aggregateSnapshots(
	truncUnit: "hour" | "day",
	filter: ReturnType<typeof and>,
	skipSingleRecords: boolean,
): Promise<number> {
	const bucketCol =
		sql<string>`date_trunc(${sql.raw(`'${truncUnit}'`)}, ${portfolioSize.createdAt})`.as(
			"bucket",
		);

	const aggregates = await db
		.select({
			modelId: portfolioSize.modelId,
			bucket: bucketCol,
			avgPortfolio: avg(portfolioSize.netPortfolio).as("avgPortfolio"),
			recordCount: count().as("recordCount"),
		})
		.from(portfolioSize)
		.where(filter)
		.groupBy(
			portfolioSize.modelId,
			sql`date_trunc(${sql.raw(`'${truncUnit}'`)}, ${portfolioSize.createdAt})`,
		);

	if (aggregates.length === 0) return 0;

	// Filter to only the buckets we need to insert
	const candidates = aggregates.filter((agg) => {
		if (!agg.avgPortfolio || !agg.bucket) return false;
		if (skipSingleRecords && Number(agg.recordCount) <= 1) return false;
		return true;
	}) as Array<{
		modelId: string;
		bucket: string;
		avgPortfolio: string;
		recordCount: number;
	}>;

	if (candidates.length === 0) return 0;

	// Batch existence check: fetch all (modelId, createdAt) pairs that already exist
	// for the candidate bucket times, instead of querying per-bucket
	const candidateBucketTimes = candidates.map((agg) => new Date(agg.bucket));
	const modelIds = [...new Set(candidates.map((agg) => agg.modelId))];

	const existingRows = await db
		.select({
			modelId: portfolioSize.modelId,
			createdAt: portfolioSize.createdAt,
		})
		.from(portfolioSize)
		.where(
			and(
				inArray(portfolioSize.modelId, modelIds),
				inArray(portfolioSize.createdAt, candidateBucketTimes),
			),
		);

	// Build a Set of "modelId:timestamp" for fast lookup
	const existingKeys = new Set(
		existingRows.map((row) => `${row.modelId}:${row.createdAt.getTime()}`),
	);

	let created = 0;
	for (const agg of candidates) {
		const bucketTime = new Date(agg.bucket);
		const key = `${agg.modelId}:${bucketTime.getTime()}`;

		if (existingKeys.has(key)) continue;

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
 * Aggregate raw snapshots from 7-30 days ago into hourly buckets.
 */
function aggregateToHourly(startDate: Date, endDate: Date): Promise<number> {
	const filter = and(
		gte(portfolioSize.createdAt, endDate),
		lt(portfolioSize.createdAt, startDate),
	);
	if (!filter) {
		throw new Error("Failed to build hourly aggregation filter");
	}
	return aggregateSnapshots("hour", filter, false);
}

/**
 * Aggregate data older than 30 days into daily buckets.
 */
function aggregateToDaily(cutoffDate: Date): Promise<number> {
	const filter = lt(portfolioSize.createdAt, cutoffDate);
	if (!filter) {
		throw new Error("Failed to build daily aggregation filter");
	}
	return aggregateSnapshots("day", filter, true);
}

/**
 * Delete raw records that have been aggregated.
 * Preserves:
 * - All data from the last 7 days
 * - First snapshot per model (origin point)
 * - Aggregated hourly/daily records
 */
async function deleteAggregatedRawRecords(
	cutoffDate: Date,
	preservedIds: Set<string>,
): Promise<number> {
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
		AND "id" NOT IN (${sql.join(
			preservedIdArray.map((id) => sql`${id}`),
			sql`, `,
		)})
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

		return entries.map((entry) => {
			const modelName = requireString(
				entry.modelName,
				`portfolio entry ${entry.id}.modelName (variant history)`,
			);
			const openRouterModelName = requireString(
				entry.modelOpenRouterName,
				`portfolio entry ${entry.id}.modelOpenRouterName (variant history)`,
			);

			return {
				id: entry.id,
				modelId: entry.modelId,
				netPortfolio: String(entry.netPortfolio),
				createdAt: entry.createdAt.toISOString(),
				updatedAt: entry.updatedAt.toISOString(),
				model: {
					name: modelName,
					variant: entry.modelVariant ?? undefined,
					openRouterModelName,
				},
			};
		});
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

	return entries.map((entry) => {
		if (!entry.model) {
			throw new Error(
				`Portfolio entry ${entry.id} is missing required model relation`,
			);
		}

		const modelName = requireString(
			entry.model.name,
			`portfolio entry ${entry.id}.model.name`,
		);
		const openRouterModelName = requireString(
			entry.model.openRouterModelName,
			`portfolio entry ${entry.id}.model.openRouterModelName`,
		);

		return {
			id: entry.id,
			modelId: entry.modelId,
			netPortfolio: String(entry.netPortfolio),
			createdAt: entry.createdAt.toISOString(),
			updatedAt: entry.updatedAt.toISOString(),
			model: {
				name: modelName,
				variant: entry.model.variant ?? undefined,
				openRouterModelName,
			},
		};
	});
}

/**
 * Auto-detect appropriate resolution from data time range.
 */
function detectResolutionFromTimeRange(
	startMs: number,
	endMs: number,
): DownsampleResolution {
	const rangeMs = endMs - startMs;
	const { THRESHOLDS } = DOWNSAMPLE_CONFIG;

	if (rangeMs <= THRESHOLDS.ONE_DAY) return "1m"; // ≤1 day: 1-minute buckets
	if (rangeMs <= THRESHOLDS.THREE_DAYS) return "5m"; // ≤3 days: 5-minute buckets
	if (rangeMs <= THRESHOLDS.SEVEN_DAYS) return "15m"; // ≤7 days: 15-minute buckets
	if (rangeMs <= THRESHOLDS.THIRTY_DAYS) return "1h"; // ≤30 days: 1-hour buckets
	return "4h"; // >30 days: 4-hour buckets
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
	if (data.length === 1)
		return { entries: data, resolution: resolution ?? "1m" };

	// Parse timestamps and sort
	const withTimestamps = data
		.map((entry) => ({
			entry,
			timestamp: new Date(entry.createdAt).getTime(),
		}))
		.filter((item) => Number.isFinite(item.timestamp))
		.sort((a, b) => a.timestamp - b.timestamp);

	if (withTimestamps.length === 0)
		return { entries: [], resolution: resolution ?? "1m" };

	const startMs = withTimestamps[0]?.timestamp;
	const endMs = withTimestamps[withTimestamps.length - 1]?.timestamp;

	// Auto-detect resolution if not provided
	const detectedResolution =
		resolution ?? detectResolutionFromTimeRange(startMs, endMs);
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
		const bucketModels = buckets.get(bucketStart);
		if (!bucketModels) {
			continue;
		}

		const value = Number(entry.netPortfolio);
		if (!Number.isFinite(value)) continue;

		if (!bucketModels.has(modelKey)) {
			const variantValues = new Map<string, number>();
			variantValues.set(entry.modelId, value);
			bucketModels.set(modelKey, {
				lastEntry: entry,
				lastValue: value,
				lastTimestamp: timestamp,
				variantValues,
			});
		} else {
			const existing = bucketModels.get(modelKey);
			if (!existing) {
				continue;
			}
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
		const bucketModels = buckets.get(bucketStart);
		if (!bucketModels) {
			continue;
		}
		const bucketTime = new Date(bucketStart).toISOString();

		for (const [
			modelKey,
			{ lastEntry, lastValue, variantValues },
		] of bucketModels) {
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
			const values = Array.from(latest.variantValues.values()).map(
				(v) => v.value,
			);
			latestValue = values.reduce((sum, v) => sum + v, 0) / values.length;
		} else {
			const firstVariantValue = latest.variantValues.values().next();
			if (firstVariantValue.done) {
				throw new Error(
					`Missing latest variant value for model ${modelKey} during downsampling`,
				);
			}
			latestValue = firstVariantValue.value.value;
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
	result.sort(
		(a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
	);

	return { entries: result, resolution: detectedResolution };
}
