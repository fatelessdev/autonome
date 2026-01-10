import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import ModelLegend from "@/components/model-legend";
import type { ChartConfig } from "@/components/ui/chart";
import { GlowingLineChart } from "@/components/ui/glowing-line";
import { Skeleton } from "@/components/ui/skeleton";
import { useVariant } from "@/components/variant-context";
import { getSseUrl } from "@/core/shared/api/apiConfig";
import { sampleForViewport } from "@/core/shared/charts/chartSampler";
import {
	PORTFOLIO_QUERIES,
	type PortfolioHistoryEntry,
	type DownsampleResolution,
} from "@/core/shared/markets/marketQueries";
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
	const variantParam = selectedVariant === "all" ? undefined : selectedVariant as "Guardian" | "Apex" | "Gladiator" | "Sniper" | "Trendsurfer" | "Contrarian" | "Sovereign";

	const {
		data: portfolioResult,
		isPending: isHistoryPending,
		isError,
	} = useQuery({
		...PORTFOLIO_QUERIES.history(variantParam),
		placeholderData: (prev) => prev, // Keep previous data during variant switch
	});

	// Extract history and resolution from the result
	const portfolioData = portfolioResult?.history;
	const resolution = portfolioResult?.resolution ?? "1m";

	// Only show skeleton on initial load, not during variant transitions
	const isPending = isHistoryPending && !portfolioData;

	// Subscribe to portfolio SSE events for real-time updates with auto-reconnect
	// Triggers refetch to get properly downsampled data from server
	useEffect(() => {
		let source: EventSource | null = null;
		let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
		let reconnectAttempts = 0;
		const MAX_RECONNECT_DELAY = 30_000; // Max 30 seconds between reconnects
		let mounted = true;

		const connect = () => {
			if (!mounted) return;
			
			source = new EventSource(getSseUrl("/api/events/portfolio"));

			source.onopen = () => {
				reconnectAttempts = 0; // Reset on successful connection
			};

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

			source.onerror = () => {
				// Don't log on every error to avoid spam during expected disconnections
				if (source?.readyState === EventSource.CLOSED) {
					source?.close();
					source = null;
					
					if (mounted) {
						// Exponential backoff: 1s, 2s, 4s, 8s, ... up to MAX_RECONNECT_DELAY
						const delay = Math.min(1000 * 2 ** reconnectAttempts, MAX_RECONNECT_DELAY);
						reconnectAttempts++;
						reconnectTimeout = setTimeout(connect, delay);
					}
				}
			};
		};

		connect();

		return () => {
			mounted = false;
			if (reconnectTimeout) {
				clearTimeout(reconnectTimeout);
			}
			source?.close();
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
		// Server now handles this, but we pass the flag for any client-side processing
		const shouldAverage = selectedVariant === "all";
		return buildChartArtifacts(portfolioData, resolution, shouldAverage);
	}, [portfolioData, resolution, selectedVariant]);

	const filteredData = useMemo(
		() => filterByTime(chartData, timeFilter),
		[chartData, timeFilter],
	);

	// Apply adaptive sampling based on viewport size
	// Desktop: 800 points, Mobile: 400 points
	// Preserves first and last points for accurate range display
	const sampledData = useMemo(
		() => sampleForViewport(filteredData, isCompact),
		[filteredData, isCompact],
	);

	const displayData = useMemo(
		() =>
			valueMode === "usd"
				? sampledData
				: toPercentData(sampledData, Object.keys(chartConfig)),
		[valueMode, sampledData, chartConfig],
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

/**
 * Format timestamp for x-axis based on resolution.
 * - 1m, 5m, 15m: "14:35" (time only - data is within a day or few days)
 * - 1h: "Jan 10 14:00" (date + time - data spans days)
 * - 4h: "Jan 10" (date only - data spans weeks/months)
 */
function formatTimestampForResolution(timestamp: number, resolution: DownsampleResolution): string {
	const date = new Date(timestamp);
	
	switch (resolution) {
		case "1m":
		case "5m":
		case "15m":
			// Short timeframes: time only
			return date.toLocaleTimeString("en-US", {
				hour: "2-digit",
				minute: "2-digit",
			});
		case "1h":
			// Medium timeframes: date + time
			return date.toLocaleDateString("en-US", {
				month: "short",
				day: "numeric",
				hour: "2-digit",
				minute: "2-digit",
			});
		case "4h":
			// Long timeframes: date only
			return date.toLocaleDateString("en-US", {
				month: "short",
				day: "numeric",
			});
		default:
			return date.toLocaleTimeString("en-US", {
				hour: "2-digit",
				minute: "2-digit",
			});
	}
}

function buildChartArtifacts(
	portfolioData: PortfolioHistoryEntry[],
	resolution: DownsampleResolution,
	_shouldAverage = false, // Server now handles averaging
): {
	chartData: DataPoint[];
	chartConfig: ChartConfig;
	seriesMeta: SeriesMeta;
} {
	// Server returns pre-downsampled data with time-based buckets and latest entries appended
	// Each entry is already averaged per model per time bucket
	// Client just converts to chart format without further aggregation
	
	const points = portfolioData
		.filter((entry) => entry.model) // Filter out entries without model
		.map((entry) => ({
			t: new Date(entry.createdAt).getTime(),
			name: entry.model!.name,
			modelId: entry.modelId,
			v: Number(entry.netPortfolio),
		}))
		.filter((point) => Number.isFinite(point.v));

	// Sort globally by time
	points.sort((a, b) => a.t - b.t);

	if (points.length === 0) {
		return { chartData: [], chartConfig: {}, seriesMeta: {} };
	}

	const modelNames = Array.from(
		new Set(points.map((point) => point.name)),
	).filter(Boolean);

	const usedKeys = new Set<string>();
	const nameToSeriesKey = new Map<string, string>();
	const seriesMeta: SeriesMeta = {};

	for (const modelName of modelNames) {
		const safeKey = createSeriesKey(modelName, usedKeys);
		nameToSeriesKey.set(modelName, safeKey);
		seriesMeta[safeKey] = { originalKey: modelName };
	}

	// Group by timestamp (server already bucketed, so same timestamps = same bucket)
	const timeGroups = new Map<number, Map<string, number>>();
	
	for (const point of points) {
		if (!timeGroups.has(point.t)) {
			timeGroups.set(point.t, new Map());
		}
		const group = timeGroups.get(point.t)!;
		const safeKey = nameToSeriesKey.get(point.name);
		if (safeKey) {
			group.set(safeKey, point.v);
		}
	}

	// Build rows from time groups
	const lastKnown: Record<string, number | null | undefined> = {};
	const rows: DataPoint[] = [];
	const sortedTimes = Array.from(timeGroups.keys()).sort((a, b) => a - b);

	for (const timestamp of sortedTimes) {
		const group = timeGroups.get(timestamp)!;
		// Use resolution-based formatting for x-axis labels
		const timeLabel = formatTimestampForResolution(timestamp, resolution);

		const row: DataPoint = { month: timeLabel, timestamp };

		for (const [_originalName, safeKey] of nameToSeriesKey.entries()) {
			const value = group.get(safeKey);
			
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
	}

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
