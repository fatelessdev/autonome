import { useState } from "react";
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
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { cn } from "@/core/lib/utils";
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
const overallColumns: ColumnDef<OverallStats>[] = [
	{
		accessorKey: "modelName",
		header: ({ column }) => <SortableHeader column={column}>Model</SortableHeader>,
		cell: ({ row }) => (
			<span className="font-medium">{row.getValue("modelName")}</span>
		),
	},
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
];

// Advanced stats columns
const advancedColumns: ColumnDef<AdvancedStats>[] = [
	{
		accessorKey: "modelName",
		header: ({ column }) => <SortableHeader column={column}>Model</SortableHeader>,
		cell: ({ row }) => (
			<span className="font-medium">{row.getValue("modelName")}</span>
		),
	},
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
];

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
		<div className="rounded-md border border-zinc-800 backdrop-blur-sm">
			<Table>
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
	);
}

function AnalyticsRoute() {
	const [mode, setMode] = useState<StatsMode>("overall");
	const [isExporting, setIsExporting] = useState(false);

	// Current view data
	const { data, isLoading, error } = useQuery(
		orpc.analytics.getModelStats.queryOptions({ input: { mode } }),
	);

	// Run info for export filename
	const { data: runInfo } = useQuery(
		orpc.analytics.getRunInfo.queryOptions({ input: {} }),
	);

	// Pre-fetch both datasets for export
	const { data: overallData, refetch: refetchOverall } = useQuery({
		...orpc.analytics.getModelStats.queryOptions({ input: { mode: "overall" } }),
		staleTime: 30000, // Cache for 30 seconds
	});
	const { data: advancedData, refetch: refetchAdvanced } = useQuery({
		...orpc.analytics.getModelStats.queryOptions({ input: { mode: "advanced" } }),
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

	return (
		<div className="relative flex h-screen flex-col overflow-hidden">
			{/* Header */}
			<header className="relative z-10 flex items-center justify-between border-b border-zinc-800 px-6 py-4">
				<h1 className="text-2xl font-semibold">Analytics</h1>
				
				<div className="flex items-center gap-4">
					{/* Export Button */}
					<Button
						variant="outline"
						size="sm"
						onClick={handleExport}
						disabled={isLoading || isExporting}
						className="gap-2"
					>
						{isExporting ? (
							<Loader2 className="h-4 w-4 animate-spin" />
						) : (
							<Download className="h-4 w-4" />
						)}
						Export Excel
					</Button>

					{/* Mode Toggle */}
					<div className="flex gap-1 rounded-lg p-1">
						<Button
							variant={mode === "overall" ? "secondary" : "ghost"}
							size="sm"
							onClick={() => setMode("overall")}
							className={cn(
								"px-4",
							)}
						>
							Overall
						</Button>
						<Button
							variant={mode === "advanced" ? "secondary" : "ghost"}
							size="sm"
							onClick={() => setMode("advanced")}
							className={cn(
								"px-4",
							)}
						>
							Advanced
						</Button>
					</div>
				</div>
			</header>

			{/* Content */}
			<main className="relative z-10 flex-1 overflow-auto p-6">
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
				) : mode === "overall" && data?.overall ? (
					<AnalyticsTable data={data.overall} columns={overallColumns} />
				) : mode === "advanced" && data?.advanced ? (
					<AnalyticsTable data={data.advanced} columns={advancedColumns} />
				) : (
					<div className="flex h-64 items-center justify-center">
						<p className="">No analytics data available</p>
					</div>
				)}
			</main>
		</div>
	);
}
