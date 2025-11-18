import NumberFlow from "@number-flow/react";
import { useEffect, useState } from "react";
import type { ChartConfig } from "@/components/ui/chart";
import { cn } from "@/core/lib/utils";
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

	const modelKeys = Object.keys(chartConfig).filter((key) =>
		Boolean(seriesMeta[key]),
	);
	const lastPoint = chartData.at(-1) ?? { month: "" };
	const isPercent = valueMode === "percent";

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
		const aValue =
			typeof lastPoint[a] === "number" ? (lastPoint[a] as number) : 0;
		const bValue =
			typeof lastPoint[b] === "number" ? (lastPoint[b] as number) : 0;
		return bValue - aValue;
	});

	return (
		<div
			className={cn("border-t px-4 py-4 sm:px-6", compact ? "pb-5" : undefined)}
		>
			<div
				className={cn(
					compact
						? "flex gap-2 overflow-x-auto pb-1"
						: "grid grid-cols-1 gap-2 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-6",
				)}
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
					const value =
						typeof lastPoint[key] === "number"
							? Number(lastPoint[key])
							: undefined;
					const displayValue =
						typeof value === "number"
							? isPercent
								? value / 100
								: value
							: undefined;
					const isHovered = hoveredLine === key;
					const isDimmed = hoveredLine && hoveredLine !== key;

					return (
						<div
							className={cn(
								"flex flex-col items-center justify-center rounded-md border px-3 py-2 text-sm transition-all cursor-pointer",
								compact ? "min-w-[180px] flex-shrink-0" : undefined,
							)}
							key={key}
							onMouseEnter={() => onHoverLine(key)}
							onMouseLeave={() => onHoverLine(null)}
							style={{
								borderColor: isHovered ? color : "hsl(var(--border))",
								borderWidth: isHovered ? "2px" : "1px",
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
								<span className="font-medium text-center">{label}</span>
							</div>
							<div
								className="mt-1 text-xs tabular-nums text-muted-foreground"
								style={{ opacity: isDimmed ? 0.4 : 1 }}
							>
								{typeof displayValue === "number" && !isPercent ? (
									<NumberFlow
										value={displayValue}
										format={{
											style: "currency",
											currency: "USD",
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
