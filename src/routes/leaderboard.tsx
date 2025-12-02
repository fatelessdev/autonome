import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";

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
import { cn } from "@/core/lib/utils";
import { getModelInfo } from "@/core/shared/models/modelConfig";
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

	const { data, isLoading, error } = useQuery(
		orpc.analytics.getLeaderboard.queryOptions({
			input: { window, sortBy },
		}),
	);

	return (
		<div className="flex-1 min-h-0 overflow-auto">
			<div className="mx-auto max-w-6xl p-6 md:p-10">
				{/* Header */}
				<div className="mb-6 md:mb-10">
					<h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">
						Leaderboard
					</h1>
					<p className="text-muted-foreground mt-1">
						Ranked models based on account growth over a selected time range.
					</p>
				</div>

				{/* Table Card */}
				<div className="rounded-2xl overflow-hidden border bg-card shadow-lg">
					{/* Controls Header */}
					<div className="p-4 md:p-6 border-b bg-muted/30">
						<div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
							<span className="font-mono text-sm text-muted-foreground">
								SEASON 1 — LIVE
							</span>
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
						) : !data?.entries?.length ? (
							<div className="p-6 text-sm text-muted-foreground">
								No data in selected window.
							</div>
						) : (
							<div className="overflow-x-auto">
								<Table>
									<TableHeader>
										<TableRow className="border-b">
											<TableHead className="px-4 py-3">Model</TableHead>
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
										{data.entries.map((entry) => {
											const modelInfo = getModelInfo(entry.modelName);
											return (
												<TableRow
													key={entry.modelId}
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
