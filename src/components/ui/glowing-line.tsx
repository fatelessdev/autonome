import NumberFlow from "@number-flow/react";
import { TrendingUp } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
	Area,
	CartesianGrid,
	ComposedChart,
	Line,
	ReferenceLine,
	Tooltip,
	type TooltipProps,
	XAxis,
	YAxis,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { type ChartConfig, ChartContainer } from "@/components/ui/chart";
import { cn } from "@/core/lib/utils";
import { getModelInfo } from "@/shared/models/modelConfig";

type ChartDatum = {
	month: string;
	[key: string]: number | string | null | undefined;
};
type SeriesMeta = Record<string, { originalKey: string }>;

const FLOW_FORMAT_CURRENCY = {
	style: "currency" as const,
	currency: "USD",
	currencyDisplay: "narrowSymbol" as const,
	minimumFractionDigits: 2,
	maximumFractionDigits: 2,
};

const FLOW_FORMAT_CURRENCY_COMPACT = {
	style: "currency" as const,
	currency: "USD",
	currencyDisplay: "narrowSymbol" as const,
	notation: "compact" as const,
	compactDisplay: "short" as const,
	minimumFractionDigits: 0,
	maximumFractionDigits: 1,
};

const FLOW_FORMAT_PERCENT = {
	style: "percent" as const,
	minimumFractionDigits: 2,
	maximumFractionDigits: 2,
};

type GlowingLineChartProps = {
	chartData: ChartDatum[];
	chartConfig: ChartConfig;
	seriesMeta: SeriesMeta;
	valueMode?: "usd" | "percent";
	onValueModeChange?: (mode: "usd" | "percent") => void;
	timeFilter?: "all" | "72h";
	onTimeFilterChange?: (filter: "all" | "72h") => void;
	hoveredLine?: string | null;
	onHoverLine?: (key: string | null) => void;
	compact?: boolean;
};

const CustomEndDot = ({
	cx,
	cy,
	value,
	dataKey,
	index,
	hoveredLine,
	seriesMeta,
	valueMode,
	chartLength,
	compact,
}: {
	cx?: number;
	cy?: number;
	value?: number;
	dataKey?: string | number | ((entry: ChartDatum) => unknown);
	index?: number;
	hoveredLine?: string | null;
	seriesMeta: SeriesMeta;
	valueMode: "usd" | "percent";
	chartLength: number;
	compact: boolean;
}) => {
	if (
		typeof cx !== "number" ||
		typeof cy !== "number" ||
		typeof index !== "number" ||
		chartLength <= 0 ||
		index !== chartLength - 1 ||
		typeof value !== "number" ||
		!Number.isFinite(value)
	) {
		return null;
	}

	const resolvedKey =
		typeof dataKey === "string"
			? dataKey
			: typeof dataKey === "number"
				? String(dataKey)
				: undefined;

	if (!resolvedKey) {
		return null;
	}

	const originalKey = seriesMeta[resolvedKey]?.originalKey ?? resolvedKey;
	const modelInfo = getModelInfo(originalKey);
	const { logo, color } = modelInfo;
	const isHovered = hoveredLine === resolvedKey;
	const isDimmed = Boolean(hoveredLine && hoveredLine !== resolvedKey);
	const fallbackGlyph =
		(modelInfo.label || originalKey || resolvedKey)
			.trim()
			.charAt(0)
			.toUpperCase() || "•";

	const numberFlowValue = valueMode === "percent" ? value / 100 : value;
	const numberFlowFormat = valueMode === "percent"
		? FLOW_FORMAT_PERCENT
		: compact
			? FLOW_FORMAT_CURRENCY_COMPACT
			: FLOW_FORMAT_CURRENCY;

	const labelWidth = compact ? 96 : 130;

	return (
		<g style={{ willChange: "opacity" }}>
			<circle
				cx={cx}
				cy={cy}
				r={isHovered ? 16 : 14}
				fill={color}
				opacity={isDimmed ? 0.3 : 1}
				style={{ transition: "r 100ms, opacity 100ms" }}
			/>
			{logo ? (
				<image
					x={cx - (isHovered ? 16 : 14)}
					y={cy - (isHovered ? 16 : 14)}
					width={isHovered ? 32 : 28}
					height={isHovered ? 32 : 28}
					href={logo}
					preserveAspectRatio="xMidYMid meet"
					style={{
						clipPath: `circle(${isHovered ? 16 : 14}px at 50% 50%)`,
						pointerEvents: "none",
						transition: "opacity 100ms",
					}}
					opacity={isDimmed ? 0.3 : 1}
				/>
			) : (
				<text
					x={cx}
					y={cy + 4}
					textAnchor="middle"
					fontSize={isHovered ? 14 : 12}
					fontWeight={700}
					fill="#fff"
					opacity={isDimmed ? 0.3 : 1}
				>
					{fallbackGlyph}
				</text>
			)}
			<foreignObject
				x={cx + 25}
				y={cy - 12}
				width={labelWidth}
				height={26}
				opacity={isDimmed ? 0.3 : 1}
				style={{ transition: "opacity 100ms" }}
			>
				<div
					style={{
						backgroundColor: color,
						color: "white",
						padding: "2px 8px",
						borderRadius: "4px",
						fontSize: "12px",
						fontWeight: "bold",
						whiteSpace: "nowrap",
						border: isHovered ? "2px solid white" : "none",
					}}
				>
					<NumberFlow value={numberFlowValue} format={numberFlowFormat} />
				</div>
			</foreignObject>
		</g>
	);
};

const CustomTooltip = ({
	active,
	payload,
	hoveredLine,
	seriesMeta,
	valueMode,
}: {
	active?: boolean;
	payload?: Array<{
		value: number;
		dataKey: string;
	}>;
	hoveredLine?: string | null;
	seriesMeta: SeriesMeta;
	valueMode: "usd" | "percent";
}) => {
	if (!active || !payload || !payload.length || !hoveredLine) {
		return null;
	}

	const hoveredData = payload.find((p) => p.dataKey === hoveredLine);
	if (!hoveredData || typeof hoveredData.value !== "number") {
		return null;
	}

	const originalKey = seriesMeta[hoveredLine]?.originalKey ?? hoveredLine;
	const modelInfo = getModelInfo(originalKey);

	const formattedValue =
		valueMode === "percent"
			? `${hoveredData.value.toFixed(1)}%`
			: new Intl.NumberFormat("en-US", {
					style: "currency",
					currency: "USD",
					currencyDisplay: "narrowSymbol",
					maximumFractionDigits: 2,
				}).format(hoveredData.value);

	return (
		<div
			style={{
				backgroundColor: modelInfo.color,
				color: "white",
				padding: "8px 12px",
				borderRadius: "6px",
				fontSize: "14px",
				fontWeight: "bold",
				boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
			}}
		>
			{formattedValue}
		</div>
	);
};

export function GlowingLineChart({
	chartData,
	chartConfig,
	seriesMeta,
	valueMode = "usd",
	onValueModeChange,
	timeFilter = "all",
	onTimeFilterChange,
	hoveredLine: externalHoveredLine,
	onHoverLine,
	compact = false,
}: GlowingLineChartProps) {
	const [internalHoveredLine, setInternalHoveredLine] = useState<string | null>(
		null,
	);
	const hoveredLine = externalHoveredLine ?? internalHoveredLine;

	const modelKeys = useMemo(
		() => Object.keys(chartConfig).filter((key) => Boolean(seriesMeta[key])),
		[chartConfig, seriesMeta],
	);

	const prioritizedKeys = useMemo(() => {
		if (!hoveredLine || !modelKeys.includes(hoveredLine)) {
			return modelKeys;
		}
		return [...modelKeys.filter((key) => key !== hoveredLine), hoveredLine];
	}, [hoveredLine, modelKeys]);

	useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}
		const logos = modelKeys
			.map((key) => getModelInfo(seriesMeta[key]?.originalKey ?? key).logo)
			.filter((logo) => typeof logo === "string" && logo.length > 0);

		const uniqueLogos = Array.from(new Set(logos));

		uniqueLogos.forEach((url) => {
			const img = new window.Image();
			img.src = url;
		});
	}, [modelKeys, seriesMeta]);

	const isPercent = valueMode === "percent";

	// Calculate dynamic y-axis based on actual data values
	const yAxisConfig = useMemo(() => {
		if (isPercent) {
			// For percent mode, find min/max percent values
			let minVal = 0;
			let maxVal = 0;
			for (const row of chartData) {
				for (const key of modelKeys) {
					const val = row[key];
					if (typeof val === "number" && Number.isFinite(val)) {
						minVal = Math.min(minVal, val);
						maxVal = Math.max(maxVal, val);
					}
				}
			}
			// Round to nice boundaries with padding
			const minBound = Math.floor(minVal / 25) * 25 - 25;
			const maxBound = Math.ceil(maxVal / 25) * 25 + 25;
			const step = Math.max(25, Math.ceil((maxBound - minBound) / 6 / 25) * 25);
			const ticks: number[] = [];
			for (let t = minBound; t <= maxBound; t += step) {
				ticks.push(t);
			}
			return {
				domain: [minBound, maxBound] as [number, number],
				ticks,
			};
		}

		// For USD mode, find min/max values across all series
		let minVal = Number.POSITIVE_INFINITY;
		let maxVal = 10000; // Default minimum
		for (const row of chartData) {
			for (const key of modelKeys) {
				const val = row[key];
				if (typeof val === "number" && Number.isFinite(val)) {
					minVal = Math.min(minVal, val);
					maxVal = Math.max(maxVal, val);
				}
			}
		}
		// Handle edge case where no data exists
		if (!Number.isFinite(minVal)) minVal = 0;

		// Calculate step size based on max value
		const step = maxVal <= 5000 ? 1000 : maxVal <= 20000 ? 2000 : 5000;

		// Round up max to next nice boundary (e.g., 11k -> 12k, 15k -> 16k)
		const maxBound = Math.ceil(maxVal / step) * step + step;

		// Dynamic lower bound rules:
		// - If lowest is less than 2k: start from 0
		// - Otherwise: round down to nearest step with 1k buffer
		let minBound: number;
		if (minVal < 2000) {
			minBound = 0;
		} else {
			// Round down to nearest step, then subtract 1k buffer
			minBound = Math.max(0, Math.floor((minVal - 1000) / step) * step);
		}

		// Generate ticks
		const range = maxBound - minBound;
		const tickCount = Math.min(6, Math.max(3, Math.ceil(range / step)));
		const actualStep = Math.ceil(range / tickCount / step) * step;
		const ticks: number[] = [];
		for (let t = minBound; t <= maxBound; t += actualStep) {
			ticks.push(t);
		}
		return {
			domain: [minBound, maxBound] as [number, number],
			ticks,
		};
	}, [chartData, modelKeys, isPercent]);

	const chartMargins = useMemo(
		() =>
			compact
				? ({ left: 0, right: 72, top: 16, bottom: 16 } as const)
				: ({ left: 10, right: 120, top: 20, bottom: 20 } as const),
		[compact],
	);

	const setHoveredLine = (key: string | null) => {
		setInternalHoveredLine(key);
		onHoverLine?.(key);
	};

	const tooltipCursor = useMemo<TooltipProps<number, string>["cursor"]>(() => {
		if (!hoveredLine) {
			return {
				stroke: "hsl(var(--muted-foreground))",
				strokeWidth: 2,
				strokeDasharray: "5 5",
				opacity: 0.5,
			};
		}

		const originalKey = seriesMeta[hoveredLine]?.originalKey ?? hoveredLine;
		const info = getModelInfo(originalKey);
		return {
			stroke: info.color,
			strokeWidth: 2,
			strokeDasharray: "5 5",
			opacity: 0.5,
		};
	}, [hoveredLine, seriesMeta]);

	return (
		<div className="flex h-full flex-col">
			<div className="border-b px-4 py-2 sm:px-6">
				<div
					className={cn(
						"flex w-full items-center justify-between gap-3",
						compact ? "gap-2" : undefined,
					)}
				>
					{/* $ and % buttons - stacked on mobile, horizontal on desktop */}
					<div className={cn("flex gap-1.5", compact ? "flex-col" : "flex-row")}>
						<Button
							aria-pressed={valueMode === "usd"}
							className={cn(
								"text-xs font-medium",
								compact ? "h-7 w-10" : "h-8 w-12 sm:w-auto sm:px-3",
							)}
							onClick={() => onValueModeChange?.("usd")}
							onKeyDown={(e) => {
								if (e.key === "Enter" || e.key === " ") {
									onValueModeChange?.("usd");
								}
							}}
							type="button"
							variant={valueMode === "usd" ? "default" : "outline"}
						>
							$
						</Button>
						<Button
							aria-pressed={valueMode === "percent"}
							className={cn(
								"text-xs font-medium",
								compact ? "h-7 w-10" : "h-8 w-12 sm:w-auto sm:px-3",
							)}
							onClick={() => onValueModeChange?.("percent")}
							onKeyDown={(e) => {
								if (e.key === "Enter" || e.key === " ") {
									onValueModeChange?.("percent");
								}
							}}
							type="button"
							variant={valueMode === "percent" ? "default" : "outline"}
						>
							%
						</Button>
					</div>
					{/* Account value text - center */}
					<div className="flex flex-1 flex-col items-center text-center">
						<div className="flex items-center justify-center gap-2">
							<h2 className={cn(
								"font-semibold uppercase tracking-wider",
								"text-sm sm:text-base"
							)}>
								TOTAL ACCOUNT VALUE
							</h2>
							<Badge
								className="border-none bg-green-500/10 text-green-500 transition-colors hover:bg-green-500/20"
								variant="outline"
							>
								<TrendingUp className={cn("mr-1", compact ? "h-3 w-3" : "h-3.5 w-3.5")} />
								<span className={cn("font-semibold", compact ? "text-[10px]" : "text-xs sm:text-sm")}>Live</span>
							</Badge>
						</div>
						<p className={cn(
							"mt-1 text-muted-foreground",
							"text-[10px] sm:text-xs"
						)}>
							Real-time model equity tracking
						</p>
					</div>
					{/* ALL and 72H buttons - stacked on mobile, horizontal on desktop */}
					<div className={cn("flex gap-2", compact ? "flex-col" : "flex-row")}>
						<Button
							aria-pressed={timeFilter === "all"}
							className={cn(
								"text-xs font-medium",
								compact ? "h-7 w-10" : "h-8 w-16 sm:w-auto sm:px-3",
							)}
							onClick={() => onTimeFilterChange?.("all")}
							onKeyDown={(e) => {
								if (e.key === "Enter" || e.key === " ") {
									onTimeFilterChange?.("all");
								}
							}}
							type="button"
							variant={timeFilter === "all" ? "default" : "outline"}
						>
							ALL
						</Button>
						<Button
							aria-pressed={timeFilter === "72h"}
							className={cn(
								"text-xs font-medium",
								compact ? "h-7 w-10" : "h-8 w-16 sm:w-auto sm:px-3",
							)}
							onClick={() => onTimeFilterChange?.("72h")}
							onKeyDown={(e) => {
								if (e.key === "Enter" || e.key === " ") {
									onTimeFilterChange?.("72h");
								}
							}}
							type="button"
							variant={timeFilter === "72h" ? "default" : "outline"}
						>
							72H
						</Button>
					</div>
				</div>
			</div>
			<div
				className={cn("min-h-0 flex-1 pb-0 pt-4", compact ? "px-4" : "px-6")}
			>
				<ChartContainer config={chartConfig} className="h-full w-full">
					<ComposedChart
						accessibilityLayer
						data={chartData}
						margin={chartMargins}
						onMouseLeave={() => setHoveredLine(null)}
						style={{ background: "transparent" }}
					>
						<defs>
							{modelKeys.map((key) => {
								const originalKey = seriesMeta[key]?.originalKey ?? key;
								const modelInfo = getModelInfo(originalKey);
								const color =
									modelInfo.color ||
									chartConfig[key]?.color ||
									"hsl(var(--chart-1))";

								return (
									<linearGradient
										key={`gradient-${key}`}
										id={`gradient-${key}`}
										x1="0"
										y1="0"
										x2="0"
										y2="1"
									>
										<stop offset="0%" stopColor={color} stopOpacity={0.25} />
										<stop offset="50%" stopColor={color} stopOpacity={0.1} />
										<stop offset="100%" stopColor={color} stopOpacity={0} />
									</linearGradient>
								);
							})}
						</defs>
						<title>Model performance over time</title>
						<CartesianGrid
							strokeDasharray="4 4"
							vertical={false}
							stroke="hsl(var(--border))"
							opacity={0.15}
							horizontalPoints={yAxisConfig.ticks}
						/>
						<XAxis
							axisLine={false}
							dataKey="month"
							tickLine={false}
							tickMargin={compact ? 4 : 8}
							tick={{
								fill: "hsl(var(--foreground))",
								fontSize: compact ? 10 : 11,
							}}
							interval="preserveStartEnd"
							angle={compact ? 0 : -45}
							textAnchor={compact ? "middle" : "end"}
							height={compact ? 40 : 60}
						/>
						<YAxis
							axisLine={false}
							domain={yAxisConfig.domain}
							ticks={yAxisConfig.ticks}
							tickFormatter={(v: number) =>
								isPercent
									? `${Math.round(v)}%`
									: new Intl.NumberFormat("en-US", {
											style: "currency",
											currency: "USD",
											maximumFractionDigits: 0,
										}).format(v)
							}
							tickLine={false}
							tick={{
								fill: "hsl(var(--foreground))",
								fontSize: compact ? 10 : 11,
							}}
							width={compact ? 64 : 80}
						/>
						{isPercent && (
							<ReferenceLine
								y={0}
								stroke="hsl(var(--muted-foreground))"
								strokeDasharray="5 5"
								opacity={0.4}
								strokeWidth={1.5}
							/>
						)}
						<Tooltip
							content={
								<CustomTooltip
									hoveredLine={hoveredLine}
									seriesMeta={seriesMeta}
									valueMode={valueMode}
								/>
							}
							cursor={tooltipCursor}
						/>
						{/* Area fills for gradient below lines */}
						{prioritizedKeys.map((key) => {
							const originalKey = seriesMeta[key]?.originalKey ?? key;
							const modelInfo = getModelInfo(originalKey);
							const isHovered = hoveredLine === key;
							const isDimmed = Boolean(hoveredLine && hoveredLine !== key);

							return (
								<Area
									key={`area-${key}`}
									dataKey={key}
									type="natural"
									fill={`url(#gradient-${key})`}
									stroke="none"
									fillOpacity={isDimmed ? 0.05 : isHovered ? 0.35 : 0.2}
									connectNulls
									animationDuration={300}
									animationEasing="ease-in-out"
								/>
							);
						})}
						{/* Lines on top of areas */}
						{prioritizedKeys.map((key) => {
							const originalKey = seriesMeta[key]?.originalKey ?? key;
							const modelInfo = getModelInfo(originalKey);
							const color =
								modelInfo.color ||
								chartConfig[key]?.color ||
								"hsl(var(--chart-1))";
							const isHovered = hoveredLine === key;
							const isDimmed = Boolean(hoveredLine && hoveredLine !== key);

							return (
								<Line
									key={key}
									connectNulls
									dataKey={key}
									type="natural"
									stroke={color}
									strokeWidth={isHovered ? 2.5 : 1.5}
									strokeOpacity={isDimmed ? 0.2 : 1}
									activeDot={false}
									onMouseEnter={() => setHoveredLine(key)}
									strokeLinecap="round"
									strokeLinejoin="round"
									animationDuration={300}
									animationEasing="ease-in-out"
									filter={
										isHovered ? `drop-shadow(0 0 6px ${color})` : undefined
									}
									z={isHovered ? 1000 : 1}
									dot={(dotProps) => {
										if (!dotProps) return null;
										const keyValue = `${String(dotProps.dataKey ?? "dot")}-${dotProps.index ?? 0}`;
										return (
											<CustomEndDot
												key={keyValue}
												{...dotProps}
												hoveredLine={hoveredLine}
												seriesMeta={seriesMeta}
												valueMode={valueMode}
												chartLength={chartData.length}
												compact={compact}
											/>
										);
									}}
								/>
							);
						})}
					</ComposedChart>
				</ChartContainer>
			</div>
		</div>
	);
}

