import { useMemo, useState, useEffect, useCallback } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueries } from "@tanstack/react-query";
import { Loader2, Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
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
import { exportLeaderboardToExcel, type LeaderboardVariantData } from "@/core/utils/excelExport";
import { orpc } from "@/server/orpc/client";

export const Route = createFileRoute("/leaderboard")({
	component: LeaderboardRoute,
});

type WindowKey = "24h" | "7d" | "30d";
type SortKey = "pnlPercent" | "pnlAbsolute" | "maxDrawdown";

const formatUsd = (value: number) =>
	new Intl.NumberFormat("en-US", {
		style: "currency",
		currency: "USD",
		currencyDisplay: "narrowSymbol",
		maximumFractionDigits: 2,
	}).format(value);

const formatPercent = (value: number) => `${value.toFixed(2)}%`;

function LeaderboardRoute() {
	const [window, setWindow] = useState<WindowKey>("7d");
	const [sortBy, setSortBy] = useState<SortKey>("pnlPercent");
	const [showAverage, setShowAverage] = useState(false);
	const [isExporting, setIsExporting] = useState(false);
	const { selectedVariant, setSelectedVariant } = useVariant();

	// Main query for current view
	const { data, isLoading, error } = useQuery(
		orpc.analytics.getLeaderboard.queryOptions({
			input: { window, sortBy, variant: selectedVariant },
		}),
	);

	// Queries for all variants (used for export)
	const variants = ["Guardian", "Apex", "Gladiator", "Sniper", "Trendsurfer", "Contrarian", "Sovereign"] as const;
	const variantQueries = useQueries({
		queries: variants.map((variant) =>
			orpc.analytics.getLeaderboard.queryOptions({
				input: { window, sortBy, variant },
			}),
		),
	});

	useEffect(() => {
		if (selectedVariant !== "all" && showAverage) {
			setShowAverage(false);
		}
	}, [selectedVariant, showAverage]);

	// Export handler
	const handleExport = useCallback(async () => {
		setIsExporting(true);
		try {
			// Build variant data from queries
			const variantData: LeaderboardVariantData[] = variants.map((variant, idx) => ({
				variant,
				entries: (variantQueries[idx]?.data?.entries ?? []).map((e) => ({
					modelName: e.modelName,
					variant: e.variant,
					pnlPercent: e.pnlPercent,
					pnlAbsolute: e.pnlAbsolute,
					maxDrawdown: e.maxDrawdown,
					startValue: e.startValue,
					endValue: e.endValue,
				})),
			}));

			exportLeaderboardToExcel(variantData, window);
		} catch (err) {
			console.error("Export failed:", err);
		} finally {
			setIsExporting(false);
		}
	}, [variantQueries, window]);

	// Calculate averaged entries when "Average" is checked (only in Aggregate mode)
	const displayEntries = useMemo(() => {
		if (!data?.entries) return [];

		if (selectedVariant !== "all" || !showAverage) {
			return data.entries;
		}

		// Group by base model name (without variant suffix) and calculate averages
		const byModelName = new Map<string, typeof data.entries>();
		for (const entry of data.entries) {
			const existing = byModelName.get(entry.modelName) ?? [];
			existing.push(entry);
			byModelName.set(entry.modelName, existing);
		}

		// Average the stats across variants for each model
		return Array.from(byModelName.entries()).map(([modelName, entries]) => {
			const avgPnlPercent = entries.reduce((sum, e) => sum + e.pnlPercent, 0) / entries.length;
			const avgPnlAbsolute = entries.reduce((sum, e) => sum + e.pnlAbsolute, 0) / entries.length;
			const avgMaxDrawdown = entries.reduce((sum, e) => sum + e.maxDrawdown, 0) / entries.length;
			const avgStartValue = entries.reduce((sum, e) => sum + e.startValue, 0) / entries.length;
			const avgEndValue = entries.reduce((sum, e) => sum + e.endValue, 0) / entries.length;

			return {
				modelId: entries[0].modelId,
				modelName,
				variant: "AVG",
				pnlPercent: avgPnlPercent,
				pnlAbsolute: avgPnlAbsolute,
				maxDrawdown: avgMaxDrawdown,
				startValue: avgStartValue,
				endValue: avgEndValue,
			};
		}).sort((a, b) => {
			if (sortBy === "pnlPercent") return b.pnlPercent - a.pnlPercent;
			if (sortBy === "pnlAbsolute") return b.pnlAbsolute - a.pnlAbsolute;
			return b.maxDrawdown - a.maxDrawdown;
		});
	}, [data?.entries, selectedVariant, showAverage, sortBy]);

	return (
		<div className="flex-1 min-h-0 overflow-hidden">
			<div className="mx-auto max-w-6xl h-full overflow-auto p-6 md:p-10 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
				{/* Header */}
				<div className="mb-6 md:mb-10 flex flex-col gap-3 md:gap-4">
					<div className="space-y-1">
						<h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">
							Leaderboard
						</h1>
						<p className="text-muted-foreground mt-1">
							Ranked models based on account growth over a selected time range.
						</p>
					</div>
					<div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:gap-3">
						<span className="font-mono text-sm text-muted-foreground">
							COMPETITION:
						</span>
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
				</div>

				{/* Table Card */}
				<div className="rounded-2xl overflow-hidden border bg-card shadow-lg">
					{/* Controls Header */}
					<div className="p-4 md:p-6 border-b bg-muted/30">
						<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
							{/* Left side: Average checkbox + Export button */}
							<div className="flex items-center gap-3">
								{selectedVariant === "all" && (
									<div className="flex items-center gap-2">
										<Checkbox
											id="average"
											checked={showAverage}
											onCheckedChange={(checked) => setShowAverage(checked === true)}
										/>
										<label
											htmlFor="average"
											className="text-sm font-medium cursor-pointer"
										>
											AVERAGE
										</label>
									</div>
								)}
								<Button
									variant="outline"
									size="sm"
									onClick={handleExport}
									disabled={isLoading || isExporting || variantQueries.some((q) => q.isLoading)}
									className="gap-2"
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
							{/* Right side: Window + Sort selectors */}
							<div className="flex items-center gap-4">
								<div className="flex items-center gap-2">
									<label className="text-sm text-muted-foreground">
										Window
									</label>
									<Select
										value={window}
										onValueChange={(v) => setWindow(v as WindowKey)}
									>
										<SelectTrigger className="w-20">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="24h">24h</SelectItem>
											<SelectItem value="7d">7d</SelectItem>
											<SelectItem value="30d">30d</SelectItem>
										</SelectContent>
									</Select>
								</div>
								<div className="flex items-center gap-2">
									<label className="text-sm text-muted-foreground">Sort</label>
									<Select
										value={sortBy}
										onValueChange={(v) => setSortBy(v as SortKey)}
									>
										<SelectTrigger className="w-32">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="pnlPercent">PnL %</SelectItem>
											<SelectItem value="pnlAbsolute">PnL $</SelectItem>
											<SelectItem value="maxDrawdown">Drawdown</SelectItem>
										</SelectContent>
									</Select>
								</div>
							</div>
						</div>
					</div>

					{/* Table Content */}
					<div className="p-0">
						{isLoading ? (
							<div className="flex h-64 items-center justify-center">
								<Loader2 className="h-8 w-8 animate-spin" />
							</div>
						) : error ? (
							<div className="p-6 text-sm text-red-500">
								Failed to load leaderboard: {error.message}
							</div>
						) : !displayEntries.length ? (
							<div className="p-6 text-sm text-muted-foreground">
								No data in selected window.
							</div>
						) : (
							<div className="overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
								<Table className="min-w-[860px]">
									<TableHeader>
										<TableRow className="border-b">
											<TableHead className="px-4 py-3">Model</TableHead>
											{selectedVariant === "all" && !showAverage && (
												<TableHead className="px-4 py-3">Variant</TableHead>
											)}
											<TableHead className="px-4 py-3 text-right">
												PnL %
											</TableHead>
											<TableHead className="px-4 py-3 text-right">
												PnL $
											</TableHead>
											<TableHead className="px-4 py-3 text-right">
												Max Drawdown
											</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{displayEntries.map((entry, idx) => {
											const modelInfo = getModelInfo(entry.modelName);
											return (
												<TableRow
													key={`${entry.modelId}-${entry.variant}-${idx}`}
													className="hover:bg-muted/50"
												>
													<TableCell className="px-4 py-3 font-semibold">
														<div className="flex items-center gap-3">
															{modelInfo.logo ? (
																<img
																	src={modelInfo.logo}
																	alt={entry.modelName}
																	className="h-6 w-6 rounded"
																/>
															) : (
																<div
																	className="h-6 w-6 rounded flex items-center justify-center text-[10px] font-bold text-white"
																	style={{
																		backgroundColor: modelInfo.color,
																	}}
																>
																	{entry.modelName.slice(0, 2).toUpperCase()}
																</div>
															)}
															<span>{entry.modelName}</span>
														</div>
													</TableCell>
													{selectedVariant === "all" && !showAverage && (
														<TableCell className="px-4 py-3">
															<span className={cn(
																"px-2 py-0.5 rounded text-xs font-medium",
																entry.variant === "Guardian" && "bg-purple-500/20 text-purple-600",
																entry.variant === "Apex" && "bg-amber-500/20 text-amber-600",
																entry.variant === "Gladiator" && "bg-green-500/20 text-green-600",
																entry.variant === "Sniper" && "bg-blue-500/20 text-blue-600",
																entry.variant === "Trendsurfer" && "bg-cyan-500/20 text-cyan-600",
																entry.variant === "Contrarian" && "bg-rose-500/20 text-rose-600",
																entry.variant === "Sovereign" && "bg-yellow-500/20 text-yellow-600",
															)}>
																{entry.variant}
															</span>
														</TableCell>
													)}
													<TableCell className="px-4 py-3 text-right">
														<span
															className={cn(
																entry.pnlPercent >= 0
																	? "text-green-500"
																	: "text-red-500",
															)}
														>
															{formatPercent(entry.pnlPercent)}
														</span>
													</TableCell>
													<TableCell className="px-4 py-3 text-right">
														<span
															className={cn(
																entry.pnlAbsolute >= 0
																	? "text-green-500"
																	: "text-red-500",
															)}
														>
															{formatUsd(entry.pnlAbsolute)}
														</span>
													</TableCell>
													<TableCell className="px-4 py-3 text-right">
														<span
															className={cn(
																entry.maxDrawdown > 20
																	? "text-red-500"
																	: entry.maxDrawdown > 10
																		? "text-yellow-500"
																		: "text-muted-foreground",
															)}
														>
															{formatPercent(entry.maxDrawdown)}
														</span>
													</TableCell>
												</TableRow>
											);
										})}
									</TableBody>
								</Table>
							</div>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}
