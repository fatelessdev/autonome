import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import ModelLegend from "@/components/model-legend";
import type { ChartConfig } from "@/components/ui/chart";
import { GlowingLineChart } from "@/components/ui/glowing-line";
import { Skeleton } from "@/components/ui/skeleton";
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

	const {
		data: portfolioData,
		isPending,
		isError,
	} = useQuery(PORTFOLIO_QUERIES.history());

	const { chartData, chartConfig, seriesMeta } = useMemo(() => {
		if (!portfolioData || portfolioData.length === 0) {
			return {
				chartData: [] as DataPoint[],
				chartConfig: {} as ChartConfig,
				seriesMeta: {} as SeriesMeta,
			};
		}
		return buildChartArtifacts(portfolioData);
	}, [portfolioData]);

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
		model: { name: string };
	}>,
): {
	chartData: DataPoint[];
	chartConfig: ChartConfig;
	seriesMeta: SeriesMeta;
} {
	const points = portfolioData
		.map((entry) => ({
			t: new Date(entry.createdAt).getTime(),
			name: entry.model.name,
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
	const tolerance = calculateBucketTolerance(points.map((point) => point.t));

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
	let bucketRows: Record<string, number> = {};
	const lastKnown: Record<string, number | null | undefined> = {};

	const flush = () => {
		if (!Object.keys(bucketRows).length) {
			return;
		}

		const center = Math.round((bucketStart + bucketEnd) / 2);
		const timestamp = new Date(center).toLocaleTimeString("en-US", {
			hour: "2-digit",
			minute: "2-digit",
		});

		const row: DataPoint = { month: timestamp, timestamp: center };

		for (const [_originalName, safeKey] of nameToSeriesKey.entries()) {
			const value = bucketRows[safeKey];
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
		bucketRows = {};
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
		bucketRows[safeKey] = point.v;
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

function calculateBucketTolerance(timestamps: number[]): number {
	if (timestamps.length < 2) {
		return 30_000;
	}

	const gaps: number[] = [];
	for (let i = 1; i < timestamps.length; i += 1) {
		gaps.push(timestamps[i] - timestamps[i - 1]);
	}

	gaps.sort((a, b) => a - b);
	const medianGap = gaps[Math.floor(gaps.length / 2)] || 60_000;
	return Math.min(30_000, Math.max(2_000, Math.floor(medianGap * 0.5)));
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
