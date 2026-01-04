import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import ModelLegend from "@/components/model-legend";
import type { ChartConfig } from "@/components/ui/chart";
import { GlowingLineChart } from "@/components/ui/glowing-line";
import { Skeleton } from "@/components/ui/skeleton";
import { useVariant } from "@/components/variant-context";
import { PORTFOLIO_QUERIES } from "@/core/shared/markets/marketQueries";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { getModelInfo } from "@/shared/models/modelConfig";

type DataPoint = {
	month: string;
	timestamp?: number;
	[key: string]: number | string | null | undefined;
};

type SeriesMeta = Record<string, { originalKey: string }>;

export default function PerformanceGraph() {
	const [valueMode, setValueMode] = useState<"usd" | "percent">("usd");
	const [timeFilter, setTimeFilter] = useState<"all" | "72h">("all");
	const [hoveredLine, setHoveredLine] = useState<string | null>(null);
	const isCompact = useMediaQuery("(max-width: 768px)", {
		defaultValue: false,
	});

	const { selectedVariant } = useVariant();
	const queryClient = useQueryClient();

	// Server-side variant filtering - pass variant to query
	const variantParam = selectedVariant === "all" ? undefined : selectedVariant as "Situational" | "Minimal" | "Guardian" | "Max" | "Sovereign";

	const {
		data: portfolioData,
		isPending,
		isError,
	} = useQuery(PORTFOLIO_QUERIES.history(variantParam));

	// Subscribe to portfolio SSE events for real-time updates
	useEffect(() => {
		const source = new EventSource("/api/events/portfolio");

		source.onmessage = (event) => {
			try {
				const payload = JSON.parse(event.data);
				// SSE stream sends the data payload directly (not wrapped in event object)
				// Invalidate query when snapshots were created (or on any valid payload)
				if (payload && (payload.snapshotsCreated > 0 || payload.lastUpdatedAt)) {
					void queryClient.invalidateQueries({ queryKey: ["portfolio", "history"] });
				}
			} catch (error) {
				console.error("[Portfolio SSE] Failed to parse payload", error);
			}
		};

		source.onerror = (error) => {
			console.error("[Portfolio SSE] Stream error", error);
		};

		return () => {
			source.close();
		};
	}, [queryClient]);

	const { chartData, chartConfig, seriesMeta } = useMemo(() => {
		if (!portfolioData || portfolioData.length === 0) {
			return {
				chartData: [] as DataPoint[],
				chartConfig: {} as ChartConfig,
				seriesMeta: {} as SeriesMeta,
			};
		}
		// Average values across variants when showing all variants (aggregate mode)
		const shouldAverage = selectedVariant === "all";
		return buildChartArtifacts(portfolioData, shouldAverage);
	}, [portfolioData, selectedVariant]);

	const filteredData = useMemo(
		() => filterByTime(chartData, timeFilter),
		[chartData, timeFilter],
	);

	const displayData = useMemo(
		() =>
			valueMode === "usd"
				? filteredData
				: toPercentData(filteredData, Object.keys(chartConfig)),
		[valueMode, filteredData, chartConfig],
	);

	if (isPending) {
		return (
			<div className="flex h-full flex-col overflow-hidden">
				<div className="flex-1 min-h-0 px-4 py-4 sm:px-6 sm:py-6">
					<Skeleton className="h-full w-full rounded-xl" />
				</div>
				<div className="flex-shrink-0 border-t px-4 py-4 sm:px-6">
					<div className="flex gap-2 overflow-x-auto sm:grid sm:grid-cols-3 sm:gap-2 lg:grid-cols-3 xl:grid-cols-6">
						{Array.from({ length: 6 }).map((_, index) => (
							<Skeleton
								// eslint-disable-next-line react/no-array-index-key
								key={index}
								className="h-12 min-w-[140px] rounded-md sm:min-w-0"
							/>
						))}
					</div>
				</div>
			</div>
		);
	}

	if (isError || chartData.length === 0) {
		return (
			<div className="flex h-64 items-center justify-center">
				<p className="text-muted-foreground">
					{isError
						? "Failed to load portfolio history."
						: "No data available yet..."}
				</p>
			</div>
		);
	}

	return (
		<div className="flex h-full flex-col overflow-hidden">
			<div className="flex-1 min-h-0">
				<GlowingLineChart
					chartConfig={chartConfig}
					chartData={displayData}
					seriesMeta={seriesMeta}
					onValueModeChange={setValueMode}
					valueMode={valueMode}
					timeFilter={timeFilter}
					onTimeFilterChange={setTimeFilter}
					hoveredLine={hoveredLine}
					onHoverLine={setHoveredLine}
					compact={isCompact}
				/>
			</div>
			<div className="flex-shrink-0">
				<ModelLegend
					chartData={displayData}
					chartConfig={chartConfig}
					seriesMeta={seriesMeta}
					valueMode={valueMode}
					hoveredLine={hoveredLine}
					onHoverLine={setHoveredLine}
					compact={isCompact}
				/>
			</div>
		</div>
	);
}

function buildChartArtifacts(
	portfolioData: Array<{
		id: string;
		modelId: string;
		netPortfolio: string;
		createdAt: string;
		model: { name: string; variant?: string };
	}>,
	shouldAverage = false,
): {
	chartData: DataPoint[];
	chartConfig: ChartConfig;
	seriesMeta: SeriesMeta;
} {
	const points = portfolioData
		.map((entry) => ({
			t: new Date(entry.createdAt).getTime(),
			name: entry.model.name,
			modelId: entry.modelId,
			v: Number(entry.netPortfolio),
		}))
		.filter((point) => Number.isFinite(point.v))
		.sort((a, b) => a.t - b.t);

	if (points.length === 0) {
		return { chartData: [], chartConfig: {}, seriesMeta: {} };
	}

	const modelNames = Array.from(
		new Set(points.map((point) => point.name)),
	).filter(Boolean);

	// Use adaptive tolerance based on total data volume
	const tolerance = calculateAdaptiveBucketTolerance(points.length);

	const usedKeys = new Set<string>();
	const nameToSeriesKey = new Map<string, string>();
	const seriesMeta: SeriesMeta = {};

	for (const modelName of modelNames) {
		const safeKey = createSeriesKey(modelName, usedKeys);
		nameToSeriesKey.set(modelName, safeKey);
		seriesMeta[safeKey] = { originalKey: modelName };
	}

	const rows: DataPoint[] = [];
	let bucketStart = points[0].t;
	let bucketEnd = points[0].t;
	// Track multiple values per series for averaging
	let bucketValues: Record<string, { values: number[]; modelIds: Set<string> }> = {};
	const lastKnown: Record<string, number | null | undefined> = {};

	const flush = () => {
		if (!Object.keys(bucketValues).length) {
			return;
		}

		const center = Math.round((bucketStart + bucketEnd) / 2);
		const timestamp = new Date(center).toLocaleTimeString("en-US", {
			hour: "2-digit",
			minute: "2-digit",
		});

		const row: DataPoint = { month: timestamp, timestamp: center };

		for (const [_originalName, safeKey] of nameToSeriesKey.entries()) {
			const bucket = bucketValues[safeKey];
			let value: number | null = null;
			
			if (bucket && bucket.values.length > 0) {
				if (shouldAverage && bucket.values.length > 1) {
					// Average across all variants for this model
					value = bucket.values.reduce((sum, v) => sum + v, 0) / bucket.values.length;
				} else {
					// Use the last value (original behavior for single variant mode)
					value = bucket.values[bucket.values.length - 1];
				}
			}
			
			if (typeof value === "number" && Number.isFinite(value)) {
				row[safeKey] = value;
				lastKnown[safeKey] = value;
			} else if (typeof lastKnown[safeKey] === "number") {
				row[safeKey] = lastKnown[safeKey];
			} else {
				row[safeKey] = null;
			}
		}

		rows.push(row);
		bucketValues = {};
	};

	for (const point of points) {
		if (point.t - bucketEnd > tolerance) {
			flush();
			bucketStart = point.t;
			bucketEnd = point.t;
		}
		bucketEnd = Math.max(bucketEnd, point.t);
		const safeKey = nameToSeriesKey.get(point.name);
		if (!safeKey) continue;
		
		// Collect all values per model name for averaging
		if (!bucketValues[safeKey]) {
			bucketValues[safeKey] = { values: [], modelIds: new Set() };
		}
		// Only add value if we haven't seen this modelId in this bucket yet
		// This ensures we don't double-count the same variant
		if (!bucketValues[safeKey].modelIds.has(point.modelId)) {
			bucketValues[safeKey].values.push(point.v);
			bucketValues[safeKey].modelIds.add(point.modelId);
		} else {
			// Update the value for this modelId (take the latest)
			const idx = Array.from(bucketValues[safeKey].modelIds).indexOf(point.modelId);
			if (idx >= 0) {
				bucketValues[safeKey].values[idx] = point.v;
			}
		}
	}
	flush();

	const chartConfig: ChartConfig = {};
	for (const [originalName, safeKey] of nameToSeriesKey.entries()) {
		const modelInfo = getModelInfo(originalName);
		chartConfig[safeKey] = {
			label: modelInfo.label,
			color: modelInfo.color,
		};
	}

	return { chartData: rows, chartConfig, seriesMeta };
}

/**
 * Calculate adaptive bucket tolerance based on data volume.
 * As data grows, increase the time interval between rendered points:
 * - < 500 points: 1 minute intervals (show all detail)
 * - 500-2000 points: 5 minute intervals
 * - 2000-5000 points: 15 minute intervals
 * - 5000-10000 points: 1 hour intervals
 * - > 10000 points: 12 hour intervals
 */
function calculateAdaptiveBucketTolerance(dataCount: number): number {
	const ONE_MINUTE = 60_000;
	const FIVE_MINUTES = 5 * ONE_MINUTE;
	const FIFTEEN_MINUTES = 15 * ONE_MINUTE;
	const ONE_HOUR = 60 * ONE_MINUTE;
	const TWELVE_HOURS = 12 * ONE_HOUR;

	if (dataCount < 500) return ONE_MINUTE;
	if (dataCount < 2000) return FIVE_MINUTES;
	if (dataCount < 5000) return FIFTEEN_MINUTES;
	if (dataCount < 10000) return ONE_HOUR;
	return TWELVE_HOURS;
}

function filterByTime(data: DataPoint[], filter: "all" | "72h"): DataPoint[] {
	if (filter !== "72h") return data;
	const cutoffTime = Date.now() - 72 * 60 * 60 * 1000;
	return data.filter((point) => {
		if (typeof point.timestamp === "number") {
			return point.timestamp >= cutoffTime;
		}
		return true;
	});
}

function toPercentData(data: DataPoint[], keys: string[]): DataPoint[] {
	if (data.length === 0) return data;

	const baseMap: Record<string, number> = {};
	for (const key of keys) {
		for (const row of data) {
			const value = row[key];
			if (typeof value === "number" && Number.isFinite(value)) {
				baseMap[key] = value;
				break;
			}
		}
	}

	return data.map((row) => {
		const next: DataPoint = { month: row.month };
		if (typeof row.timestamp === "number") {
			next.timestamp = row.timestamp;
		}
		for (const key of keys) {
			const base = baseMap[key];
			const value = row[key];
			if (typeof value !== "number" || !Number.isFinite(value)) {
				next[key] = null;
				continue;
			}

			if (typeof base === "number" && Number.isFinite(base) && base !== 0) {
				next[key] = ((value - base) / Math.abs(base)) * 100;
			} else if (base === 0) {
				next[key] = value === 0 ? 0 : null;
			} else {
				next[key] = null;
			}
		}
		return next;
	});
}

function createSeriesKey(modelName: string, used: Set<string>): string {
	const base = modelName
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.trim();

	const initial = base || "series";
	let candidate = initial;
	let index = 1;
	while (used.has(candidate)) {
		candidate = `${initial}-${index}`;
		index += 1;
	}
	used.add(candidate);
	return candidate;
}
