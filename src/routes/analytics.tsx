import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
	type ColumnDef,
	type SortingState,
	flexRender,
	getCoreRowModel,
	getSortedRowModel,
	useReactTable,
} from "@tanstack/react-table";
import { ArrowUpDown, ChevronDown, ChevronUp, Download, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { VariantSelector } from "@/components/variant-selector";
import { useVariant, type VariantId } from "@/components/variant-context";
import { cn } from "@/core/lib/utils";
import { getModelInfo } from "@/core/shared/models/modelConfig";
import { formatHoldTime } from "@/core/shared/trading/calculations";
import { orpc } from "@/server/orpc/client";
import type {
	OverallStats,
	AdvancedStats,
} from "@/server/features/analytics/types";
import { exportAnalyticsToExcel } from "@/core/utils/excelExport";

export const Route = createFileRoute("/analytics")({
	component: AnalyticsRoute,
});

type StatsMode = "overall" | "advanced";
// Currency formatter
const formatUsd = (value: number) =>
	new Intl.NumberFormat("en-US", {
		style: "currency",
		currency: "USD",
		currencyDisplay: "narrowSymbol",
		maximumFractionDigits: 2,
	}).format(value);

// Percent formatter
const formatPercent = (value: number, decimals = 2) =>
	`${value >= 0 ? "+" : ""}${value.toFixed(decimals)}%`;

const normalizeModelKey = (value: string) =>
	value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "") || "model";

const averageNumber = (values: number[]) =>
	values.length === 0
		? 0
		: values.reduce((sum, current) => sum + current, 0) / values.length;

function averageOverallByModel(stats: OverallStats[]): OverallStats[] {
	const grouped = new Map<string, OverallStats[]>();
	stats.forEach((entry) => {
		const key = entry.modelName || entry.modelId;
		const bucket = grouped.get(key) ?? [];
		bucket.push(entry);
		grouped.set(key, bucket);
	});

	const numericKeys: Array<keyof OverallStats> = [
		"accountValue",
		"returnPercent",
		"totalPnl",
		"winRate",
		"biggestWin",
		"biggestLoss",
		"sharpeRatio",
		"tradesCount",
	];

	return Array.from(grouped.entries()).map(([modelName, entries]) => {
		const result: OverallStats = {
			modelId: `avg-${normalizeModelKey(modelName)}`,
			modelName,
			accountValue: 0,
			returnPercent: 0,
			totalPnl: 0,
			winRate: 0,
			biggestWin: 0,
			biggestLoss: 0,
			sharpeRatio: 0,
			tradesCount: 0,
		};

		for (const key of numericKeys) {
			(result as unknown as Record<string, number>)[key] = averageNumber(entries.map((entry) => entry[key] as number));
		}

		return result;
	});
}

function averageAdvancedByModel(stats: AdvancedStats[]): AdvancedStats[] {
	const grouped = new Map<string, AdvancedStats[]>();
	stats.forEach((entry) => {
		const key = entry.modelName || entry.modelId;
		const bucket = grouped.get(key) ?? [];
		bucket.push(entry);
		grouped.set(key, bucket);
	});

	const numericKeys: Array<keyof AdvancedStats> = [
		"accountValue",
		"avgTradeSize",
		"medianTradeSize",
		"maxTradeSize",
		"avgHoldTimeMinutes",
		"medianHoldTimeMinutes",
		"maxHoldTimeMinutes",
		"longPercent",
		"expectancy",
		"avgLeverage",
		"medianLeverage",
		"maxLeverage",
		"avgConfidence",
		"medianConfidence",
		"maxConfidence",
		"failedWorkflowCount",
		"failedToolCallCount",
		"invocationCount",
		"failureRate",
	];

	return Array.from(grouped.entries()).map(([modelName, entries]) => {
		const result: AdvancedStats = {
			modelId: `avg-${normalizeModelKey(modelName)}`,
			modelName,
			accountValue: 0,
			avgTradeSize: 0,
			medianTradeSize: 0,
			maxTradeSize: 0,
			avgHoldTimeMinutes: 0,
			medianHoldTimeMinutes: 0,
			maxHoldTimeMinutes: 0,
			longPercent: 0,
			expectancy: 0,
			avgLeverage: 0,
			medianLeverage: 0,
			maxLeverage: 0,
			avgConfidence: 0,
			medianConfidence: 0,
			maxConfidence: 0,
			failedWorkflowCount: 0,
			failedToolCallCount: 0,
			invocationCount: 0,
			failureRate: 0,
		};

		for (const key of numericKeys) {
			(result as unknown as Record<string, number>)[key] = averageNumber(entries.map((entry) => entry[key] as number));
		}

		return result;
	});
}

// Sortable header component
function SortableHeader({
	column,
	children,
}: {
	column: { getIsSorted: () => false | "asc" | "desc"; toggleSorting: () => void };
	children: React.ReactNode;
}) {
	const sorted = column.getIsSorted();
	return (
		<Button
			variant="ghost"
			className="-ml-4 h-8 px-4"
			onClick={() => column.toggleSorting()}
		>
			{children}
			{sorted === "asc" ? (
				<ChevronUp className="ml-2 h-4 w-4" />
			) : sorted === "desc" ? (
				<ChevronDown className="ml-2 h-4 w-4" />
			) : (
				<ArrowUpDown className="ml-2 h-4 w-4 opacity-50" />
			)}
		</Button>
	);
}

// Overall stats columns
function getOverallColumns(showVariant: boolean): ColumnDef<OverallStats>[] {
	const columns: ColumnDef<OverallStats>[] = [
		{
			accessorKey: "modelName",
			header: ({ column }) => <SortableHeader column={column}>Model</SortableHeader>,
			cell: ({ row }) => {
				const modelName = row.getValue<string>("modelName");
				const modelInfo = getModelInfo(modelName);
				return (
					<div className="flex items-center gap-2">
						{modelInfo.logo ? (
							<img
								src={modelInfo.logo}
								alt={modelName}
								className="h-5 w-5 rounded"
							/>
						) : (
							<div
								className="h-5 w-5 rounded flex items-center justify-center text-[8px] font-bold text-white"
								style={{ backgroundColor: modelInfo.color }}
							>
								{modelName.slice(0, 2).toUpperCase()}
							</div>
						)}
						<span className="font-medium">{modelName}</span>
					</div>
				);
			},
		},
	];

	if (showVariant) {
		columns.push({
			accessorKey: "variant",
			header: ({ column }) => <SortableHeader column={column}>Variant</SortableHeader>,
			cell: ({ row }) => {
				const variant = row.getValue<string>("variant");
				return (
					<span className={cn(
						"px-2 py-0.5 rounded text-xs font-medium",
						variant === "Situational" && "bg-green-500/20 text-green-600",
						variant === "Minimal" && "bg-amber-500/20 text-amber-600",
						variant === "Guardian" && "bg-purple-500/20 text-purple-600",
						variant === "Max" && "bg-blue-500/20 text-blue-600",
					)}>
						{variant}
					</span>
				);
			},
		});
	}

	columns.push(
		{
			accessorKey: "accountValue",
			header: ({ column }) => (
				<SortableHeader column={column}>Account Value</SortableHeader>
			),
			cell: ({ row }) => formatUsd(row.getValue("accountValue")),
		},
		{
			accessorKey: "returnPercent",
			header: ({ column }) => (
				<SortableHeader column={column}>Return %</SortableHeader>
			),
			cell: ({ row }) => {
				const value = row.getValue<number>("returnPercent");
				return (
					<span className={cn(value >= 0 ? "text-green-500" : "text-red-500")}>
						{formatPercent(value)}
					</span>
				);
			},
		},
		{
			accessorKey: "totalPnl",
			header: ({ column }) => (
				<SortableHeader column={column}>Total P&L</SortableHeader>
			),
			cell: ({ row }) => {
				const value = row.getValue<number>("totalPnl");
				return (
					<span className={cn(value >= 0 ? "text-green-500" : "text-red-500")}>
						{formatUsd(value)}
					</span>
				);
			},
		},
		{
			accessorKey: "winRate",
			header: ({ column }) => (
				<SortableHeader column={column}>Win Rate</SortableHeader>
			),
			cell: ({ row }) => `${row.getValue<number>("winRate").toFixed(1)}%`,
		},
		{
			accessorKey: "biggestWin",
			header: ({ column }) => (
				<SortableHeader column={column}>Biggest Win</SortableHeader>
			),
			cell: ({ row }) => (
				<span className="text-green-500">
					{formatUsd(row.getValue("biggestWin"))}
				</span>
			),
		},
		{
			accessorKey: "biggestLoss",
			header: ({ column }) => (
				<SortableHeader column={column}>Biggest Loss</SortableHeader>
			),
			cell: ({ row }) => (
				<span className="text-red-500">
					{formatUsd(row.getValue("biggestLoss"))}
				</span>
			),
		},
		{
			accessorKey: "sharpeRatio",
			header: ({ column }) => (
				<SortableHeader column={column}>Sharpe</SortableHeader>
			),
			cell: ({ row }) => row.getValue<number>("sharpeRatio").toFixed(2),
		},
		{
			accessorKey: "tradesCount",
			header: ({ column }) => (
				<SortableHeader column={column}>Trades</SortableHeader>
			),
		},
	);

	return columns;
}

// Advanced stats columns
function getAdvancedColumns(showVariant: boolean): ColumnDef<AdvancedStats>[] {
	const columns: ColumnDef<AdvancedStats>[] = [
		{
			accessorKey: "modelName",
			header: ({ column }) => <SortableHeader column={column}>Model</SortableHeader>,
			cell: ({ row }) => {
				const modelName = row.getValue<string>("modelName");
				const modelInfo = getModelInfo(modelName);
				return (
					<div className="flex items-center gap-2">
						{modelInfo.logo ? (
							<img
								src={modelInfo.logo}
								alt={modelName}
								className="h-5 w-5 rounded"
							/>
						) : (
							<div
								className="h-5 w-5 rounded flex items-center justify-center text-[8px] font-bold text-white"
								style={{ backgroundColor: modelInfo.color }}
							>
								{modelName.slice(0, 2).toUpperCase()}
							</div>
						)}
						<span className="font-medium">{modelName}</span>
					</div>
				);
			},
		},
	];

	if (showVariant) {
		columns.push({
			accessorKey: "variant",
			header: ({ column }) => <SortableHeader column={column}>Variant</SortableHeader>,
			cell: ({ row }) => {
				const variant = row.getValue<string>("variant");
				return (
					<span className={cn(
						"px-2 py-0.5 rounded text-xs font-medium",
						variant === "Situational" && "bg-green-500/20 text-green-600",
						variant === "Minimal" && "bg-amber-500/20 text-amber-600",
						variant === "Guardian" && "bg-purple-500/20 text-purple-600",
						variant === "Max" && "bg-blue-500/20 text-blue-600",
					)}>
						{variant}
					</span>
				);
			},
		});
	}

	columns.push(
		{
			accessorKey: "accountValue",
			header: ({ column }) => (
				<SortableHeader column={column}>Account Value</SortableHeader>
			),
			cell: ({ row }) => formatUsd(row.getValue("accountValue")),
		},
		{
			accessorKey: "avgTradeSize",
			header: ({ column }) => (
				<SortableHeader column={column}>Avg Trade Size</SortableHeader>
			),
			cell: ({ row }) => formatUsd(row.getValue("avgTradeSize")),
		},
		{
			accessorKey: "medianTradeSize",
			header: ({ column }) => (
				<SortableHeader column={column}>Med Trade Size</SortableHeader>
			),
			cell: ({ row }) => formatUsd(row.getValue("medianTradeSize")),
		},
		{
			accessorKey: "maxTradeSize",
			header: ({ column }) => (
				<SortableHeader column={column}>Max Trade Size</SortableHeader>
			),
			cell: ({ row }) => formatUsd(row.getValue("maxTradeSize")),
		},
		{
			accessorKey: "avgHoldTimeMinutes",
			header: ({ column }) => (
				<SortableHeader column={column}>Avg Hold</SortableHeader>
			),
			cell: ({ row }) => formatHoldTime(row.getValue("avgHoldTimeMinutes")),
		},
		{
			accessorKey: "medianHoldTimeMinutes",
			header: ({ column }) => (
				<SortableHeader column={column}>Med Hold</SortableHeader>
			),
			cell: ({ row }) => formatHoldTime(row.getValue("medianHoldTimeMinutes")),
		},
		{
			accessorKey: "maxHoldTimeMinutes",
			header: ({ column }) => (
				<SortableHeader column={column}>Max Hold</SortableHeader>
			),
			cell: ({ row }) => formatHoldTime(row.getValue("maxHoldTimeMinutes")),
		},
		{
			accessorKey: "longPercent",
			header: ({ column }) => (
				<SortableHeader column={column}>% Long</SortableHeader>
			),
			cell: ({ row }) => `${row.getValue<number>("longPercent").toFixed(1)}%`,
		},
		{
			accessorKey: "expectancy",
			header: ({ column }) => (
				<SortableHeader column={column}>Expectancy</SortableHeader>
			),
			cell: ({ row }) => {
				const value = row.getValue<number>("expectancy");
				return (
					<span className={cn(value >= 0 ? "text-green-500" : "text-red-500")}>
						{formatUsd(value)}
					</span>
				);
			},
		},
		{
			accessorKey: "avgLeverage",
			header: ({ column }) => (
				<SortableHeader column={column}>Avg Lev</SortableHeader>
			),
			cell: ({ row }) => `${row.getValue<number>("avgLeverage").toFixed(1)}x`,
		},
		{
			accessorKey: "medianLeverage",
			header: ({ column }) => (
				<SortableHeader column={column}>Med Lev</SortableHeader>
			),
			cell: ({ row }) => `${row.getValue<number>("medianLeverage").toFixed(1)}x`,
		},
		{
			accessorKey: "maxLeverage",
			header: ({ column }) => (
				<SortableHeader column={column}>Max Lev</SortableHeader>
			),
			cell: ({ row }) => `${row.getValue<number>("maxLeverage").toFixed(1)}x`,
		},
		{
			accessorKey: "avgConfidence",
			header: ({ column }) => (
				<SortableHeader column={column}>Avg Conf</SortableHeader>
			),
			cell: ({ row }) => {
				const val = row.getValue<number>("avgConfidence");
				return val > 0 ? `${val.toFixed(1)}%` : "—";
			},
		},
		{
			accessorKey: "medianConfidence",
			header: ({ column }) => (
				<SortableHeader column={column}>Med Conf</SortableHeader>
			),
			cell: ({ row }) => {
				const val = row.getValue<number>("medianConfidence");
				return val > 0 ? `${val.toFixed(1)}%` : "—";
			},
		},
		{
			accessorKey: "maxConfidence",
			header: ({ column }) => (
				<SortableHeader column={column}>Max Conf</SortableHeader>
			),
			cell: ({ row }) => {
				const val = row.getValue<number>("maxConfidence");
				return val > 0 ? `${val.toFixed(1)}%` : "—";
			},
		},
	);

	return columns;
}

function AnalyticsTable<T extends OverallStats | AdvancedStats>({
	data,
	columns,
}: {
	data: T[];
	columns: ColumnDef<T>[];
}) {
	const [sorting, setSorting] = useState<SortingState>([]);

	const table = useReactTable({
		data,
		columns,
		getCoreRowModel: getCoreRowModel(),
		getSortedRowModel: getSortedRowModel(),
		onSortingChange: setSorting,
		state: { sorting },
	});

	return (
		<div className="rounded-md border border-zinc-800 backdrop-blur-sm overflow-hidden">
			<div className="overflow-x-hidden">
				<Table className="min-w-full table-auto">
					<TableHeader>
						{table.getHeaderGroups().map((headerGroup) => (
							<TableRow key={headerGroup.id} className="border-zinc-800">
								{headerGroup.headers.map((header) => (
									<TableHead
										key={header.id}
										className=""
									>
										{header.isPlaceholder
											? null
											: flexRender(
												header.column.columnDef.header,
												header.getContext(),
										)}
									</TableHead>
								))}
							</TableRow>
						))}
					</TableHeader>
					<TableBody>
						{table.getRowModel().rows?.length ? (
							table.getRowModel().rows.map((row) => (
								<TableRow
									key={row.id}
									className="border-zinc-800"
								>
									{row.getVisibleCells().map((cell) => (
										<TableCell key={cell.id} className="">
											{flexRender(
													cell.column.columnDef.cell,
													cell.getContext(),
											)}
										</TableCell>
									))}
								</TableRow>
							))
						) : (
							<TableRow>
								<TableCell
									colSpan={columns.length}
									className="h-24 text-center"
								>
									No data available
								</TableCell>
							</TableRow>
						)}
					</TableBody>
				</Table>
			</div>
		</div>
	);
}

function AnalyticsRoute() {
	const [mode, setMode] = useState<StatsMode>("overall");
	const [showAverage, setShowAverage] = useState(false);
	const [isExporting, setIsExporting] = useState(false);
	const { selectedVariant, setSelectedVariant } = useVariant();

	// Current view data
	const { data, isLoading, error } = useQuery(
		orpc.analytics.getModelStats.queryOptions({ input: { mode, variant: selectedVariant } }),
	);

	// Run info for export filename
	const { data: runInfo } = useQuery(
		orpc.analytics.getRunInfo.queryOptions({ input: {} }),
	);

	// Pre-fetch both datasets for export
	const { data: overallData, refetch: refetchOverall } = useQuery({
		...orpc.analytics.getModelStats.queryOptions({ input: { mode: "overall", variant: selectedVariant } }),
		staleTime: 30000, // Cache for 30 seconds
	});
	const { data: advancedData, refetch: refetchAdvanced } = useQuery({
		...orpc.analytics.getModelStats.queryOptions({ input: { mode: "advanced", variant: selectedVariant } }),
		staleTime: 30000,
	});

	const handleExport = async () => {
		setIsExporting(true);
		try {
			// Ensure we have fresh data
			const [overallResult, advancedResult] = await Promise.all([
				refetchOverall(),
				refetchAdvanced(),
			]);
			
			const overall = overallResult.data?.overall ?? overallData?.overall ?? [];
			const advanced = advancedResult.data?.advanced ?? advancedData?.advanced ?? [];
			
			if (overall.length === 0 && advanced.length === 0) {
				console.warn("No data to export");
				return;
			}
			
			exportAnalyticsToExcel(overall, advanced, runInfo?.runStartTime ?? null);
		} finally {
			setIsExporting(false);
		}
	};

	useEffect(() => {
		if (selectedVariant !== "all" && showAverage) {
			setShowAverage(false);
		}
	}, [selectedVariant, showAverage]);

	const displayOverall = useMemo(() => {
		if (!data?.overall) return [];
		if (selectedVariant !== "all" || !showAverage) return data.overall;
		return averageOverallByModel(data.overall);
	}, [data?.overall, selectedVariant, showAverage]);

	const displayAdvanced = useMemo(() => {
		if (!data?.advanced) return [];
		if (selectedVariant !== "all" || !showAverage) return data.advanced;
		return averageAdvancedByModel(data.advanced);
	}, [data?.advanced, selectedVariant, showAverage]);

	return (
		<div className="relative flex h-screen flex-col overflow-hidden">
			{/* Header */}
			<header className="relative z-10 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-zinc-800 px-6 py-4">
				<h1 className="text-2xl font-semibold">Analytics</h1>
				
				<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
					{/* Variant Filter - own row on mobile */}
					<div className="flex items-center gap-2">
						<span className="text-sm text-muted-foreground font-mono">COMPETITION:</span>
						<VariantSelector
							value={selectedVariant as VariantId}
							onChange={setSelectedVariant}
							className="hidden sm:inline-flex"
						/>
						<VariantSelector
							layout="mobile"
							value={selectedVariant as VariantId}
							onChange={setSelectedVariant}
							className="sm:hidden"
						/>
					</div>

					{/* Controls row - Mode Toggle + Average + Export on same line */}
					<div className="flex items-center gap-2 sm:gap-4 flex-wrap">
						{/* Mode Toggle */}
						<div className="flex gap-1 rounded-lg p-1">
							<Button
								variant={mode === "overall" ? "secondary" : "ghost"}
								size="sm"
								onClick={() => setMode("overall")}
								className="px-3 sm:px-4"
							>
								Overall
							</Button>
							<Button
								variant={mode === "advanced" ? "secondary" : "ghost"}
								size="sm"
								onClick={() => setMode("advanced")}
								className="px-3 sm:px-4"
							>
								Advanced
							</Button>
						</div>

						{/* Average checkbox - only show in aggregate mode */}
						{selectedVariant === "all" && (
							<div className="flex items-center gap-1.5">
								<Checkbox
									id="average-analytics"
									checked={showAverage}
									onCheckedChange={(checked) => setShowAverage(checked === true)}
								/>
								<label
									htmlFor="average-analytics"
									className="text-xs sm:text-sm font-medium cursor-pointer"
								>
									AVG
								</label>
							</div>
						)}

						{/* Export Button */}
						<Button
							variant="outline"
							size="sm"
							onClick={handleExport}
							disabled={isLoading || isExporting}
							className="gap-1.5 sm:gap-2"
						>
							{isExporting ? (
								<Loader2 className="h-4 w-4 animate-spin" />
							) : (
								<Download className="h-4 w-4" />
							)}
							<span className="hidden sm:inline">Export Excel</span>
							<span className="sm:hidden">Export</span>
						</Button>
					</div>
				</div>
			</header>

			{/* Content */}
			<main className="relative z-10 flex-1 overflow-auto p-6 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
				{isLoading ? (
					<div className="flex h-64 items-center justify-center">
						<Loader2 className="h-8 w-8 animate-spin" />
					</div>
				) : error ? (
					<div className="flex h-64 items-center justify-center">
						<p className="text-red-500">
							Failed to load analytics: {error.message}
						</p>
					</div>
					) : mode === "overall" && displayOverall.length ? (
						<AnalyticsTable data={displayOverall} columns={getOverallColumns(selectedVariant === "all" && !showAverage)} />
					) : mode === "advanced" && displayAdvanced.length ? (
						<AnalyticsTable data={displayAdvanced} columns={getAdvancedColumns(selectedVariant === "all" && !showAverage)} />
				) : (
					<div className="flex h-64 items-center justify-center">
						<p className="">No analytics data available</p>
					</div>
				)}
			</main>
		</div>
	);
}
