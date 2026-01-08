import NumberFlow from "@number-flow/react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { ChartConfig } from "@/components/ui/chart";
import { useVariant } from "@/components/variant-context";
import { cn } from "@/core/lib/utils";
import { PORTFOLIO_QUERIES } from "@/core/shared/markets/marketQueries";
import { formatCurrencyValue } from "@/shared/formatting/numberFormat";
import { getModelInfo } from "@/shared/models/modelConfig";

type ModelLegendProps = {
	chartData: Array<{
		month: string;
		[key: string]: number | string | null | undefined;
	}>;
	chartConfig: ChartConfig;
	seriesMeta: Record<string, { originalKey: string }>;
	valueMode?: "usd" | "percent";
	hoveredLine: string | null;
	onHoverLine: (key: string | null) => void;
	compact?: boolean;
};

export default function ModelLegend({
	chartData,
	chartConfig,
	seriesMeta,
	valueMode = "usd",
	hoveredLine,
	onHoverLine,
	compact = false,
}: ModelLegendProps) {
	const [imagesLoaded, setImagesLoaded] = useState(false);
	const { selectedVariant } = useVariant();
	const variantParam =
		selectedVariant === "all"
			? undefined
			: (selectedVariant as
					| "Guardian"
					| "Apex"
					| "Gladiator"
					| "Sniper"
					| "Trendsurfer"
					| "Contrarian");

	const { data: latestValues } = useQuery({
		...PORTFOLIO_QUERIES.latest(variantParam),
		placeholderData: (prev) => prev, // Keep previous data during variant switch to prevent layout shift
	});
	const latestByModelName = new Map(
		(latestValues ?? []).map((v) => [v.modelName, v]),
	);

	const modelKeys = Object.keys(chartConfig).filter((key) =>
		Boolean(seriesMeta[key]),
	);
	const isPercent = valueMode === "percent";

	const baseBySeriesKey = (() => {
		const base: Record<string, number | undefined> = {};
		for (const key of modelKeys) {
			for (const row of chartData) {
				const value = row[key];
				if (typeof value === "number" && Number.isFinite(value)) {
					base[key] = value;
					break;
				}
			}
		}
		return base;
	})();

	// Preload all model logos
	useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}

		if (compact) {
			setImagesLoaded(true);
			return () => undefined;
		}

		const modelLogos = modelKeys
			.map((key) => getModelInfo(seriesMeta[key]?.originalKey ?? key).logo)
			.filter(
				(logo): logo is string => typeof logo === "string" && logo.length > 0,
			);

		if (modelLogos.length === 0) {
			setImagesLoaded(true);
			return;
		}

		setImagesLoaded(false);
		const uniqueLogos = Array.from(new Set(modelLogos));

		let cancelled = false;

		const imagePromises = uniqueLogos.map((url) => {
			return new Promise((resolve, reject) => {
				const img = new window.Image();
				img.onload = resolve;
				img.onerror = reject;
				img.src = url;
			});
		});

		Promise.allSettled(imagePromises).finally(() => {
			if (!cancelled) {
				setImagesLoaded(true);
			}
		});

		return () => {
			cancelled = true;
		};
	}, [modelKeys, seriesMeta, compact]);

	const formatValue = (v?: number): string => {
		if (typeof v !== "number" || Number.isNaN(v)) {
			return "";
		}
		if (isPercent) {
			return new Intl.NumberFormat("en-US", {
				style: "percent",
				minimumFractionDigits: 2,
				maximumFractionDigits: 2,
			}).format(v);
		}
		const currencyLabel = formatCurrencyValue(v);
		return currencyLabel === "N/A" ? "" : currencyLabel;
	};

	// Sort model keys by current value (descending)
	const sortedModelKeys = [...modelKeys].sort((a, b) => {
		const aOriginalKey = seriesMeta[a]?.originalKey ?? a;
		const bOriginalKey = seriesMeta[b]?.originalKey ?? b;
		const aLatest = latestByModelName.get(aOriginalKey)?.value;
		const bLatest = latestByModelName.get(bOriginalKey)?.value;
		const aValue = typeof aLatest === "number" && Number.isFinite(aLatest) ? aLatest : 0;
		const bValue = typeof bLatest === "number" && Number.isFinite(bLatest) ? bLatest : 0;
		return bValue - aValue;
	});

	return (
		<div
			className={cn("border-t py-1 sm:py-2.5")}
		>
			<div
				className={cn(
					"flex gap-3 overflow-x-auto overflow-y-visible pb-2 pt-1 px-4 sm:px-4 scrollbar-hide",
					compact ? "gap-2" : undefined,
				)}
				style={{
					scrollbarWidth: "none",
					msOverflowStyle: "none",
				}}
			>
				{sortedModelKeys.map((key) => {
					const originalKey = seriesMeta[key]?.originalKey ?? key;
					const modelInfo = getModelInfo(originalKey);
					const color =
						modelInfo?.color ||
						chartConfig[key]?.color ||
						"hsl(var(--chart-1))";
					const label = modelInfo?.label || chartConfig[key]?.label || key;
					const logo = modelInfo?.logo;
					const latest = latestByModelName.get(originalKey)?.value;
					const value =
						typeof latest === "number" && Number.isFinite(latest)
							? latest
							: undefined;
					const displayValue = (() => {
						if (typeof value !== "number") return undefined;
						if (!isPercent) return value;
						const base = baseBySeriesKey[key];
						if (typeof base === "number" && Number.isFinite(base) && base !== 0) {
							return ((value - base) / Math.abs(base)) as number;
						}
						return undefined;
					})();
					const isHovered = hoveredLine === key;
					const isDimmed = hoveredLine && hoveredLine !== key;

					return (
						<div
							className={cn(
								"flex flex-col items-center justify-center rounded-md border-2 px-3 py-2 text-sm cursor-pointer",
								"transition-[border-color,transform,box-shadow] duration-150 ease-out",
								"min-w-[140px] flex-shrink-0",
							)}
							key={key}
							onMouseEnter={() => onHoverLine(key)}
							onMouseLeave={() => onHoverLine(null)}
							style={{
								borderColor: isHovered ? color : "transparent",
								background: isHovered ? undefined : "hsl(var(--card))",
								outline: isHovered ? "none" : "1px solid hsl(var(--border))",
								transform: isHovered ? "scale(1.05)" : "scale(1)",
								boxShadow: isHovered ? `0 0 12px ${color}33` : "none",
								zIndex: isHovered ? 2 : 1,
							}}
						>
							<div
								className="flex items-center gap-2"
								style={{ opacity: isDimmed ? 0.4 : 1 }}
							>
								{logo ? (
									<div
										style={{
											width: "20px",
											height: "20px",
											borderRadius: "50%",
											backgroundColor: color,
											display: "flex",
											alignItems: "center",
											justifyContent: "center",
											overflow: "hidden",
											flexShrink: 0,
										}}
									>
										<img
											src={logo}
											alt={String(label)}
											width={16}
											height={16}
											className="h-4 w-4 object-contain"
											loading="lazy"
											style={{
												display: imagesLoaded ? "block" : "none",
												objectFit: "contain",
											}}
										/>
									</div>
								) : (
									<span
										aria-hidden
										className="h-3 w-3 rounded-full"
										style={{ backgroundColor: color }}
									/>
								)}
								<span className="font-medium text-center text-xs sm:text-sm">{label}</span>
							</div>
							<div
								className="mt-1 text-[10px] sm:text-xs tabular-nums text-muted-foreground"
								style={{ opacity: isDimmed ? 0.4 : 1 }}
							>
								{typeof displayValue === "number" && !isPercent ? (
									<NumberFlow
										value={displayValue}
										format={{
											style: "currency",
											currency: "USD",
											currencyDisplay: "narrowSymbol",
											minimumFractionDigits: 2,
											maximumFractionDigits: 2,
										}}
									/>
								) : typeof displayValue === "number" && isPercent ? (
									<NumberFlow
										value={displayValue}
										format={{
											style: "percent",
											minimumFractionDigits: 2,
											maximumFractionDigits: 2,
										}}
									/>
								) : (
									<span>{formatValue(displayValue)}</span>
								)}
							</div>
						</div>
					);
				})}
			</div>
		</div>
	);
}
