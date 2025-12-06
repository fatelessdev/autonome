import { useState, useMemo, useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Loader2, AlertTriangle, Clock, Zap, DollarSign } from "lucide-react";

import { VariantSelector } from "@/components/variant-selector";
import { useVariant, type VariantId } from "@/components/variant-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
import type { FailureEntry } from "@/server/features/analytics/types";

export const Route = createFileRoute("/failures")({
	component: FailuresRoute,
});

type VariantFilter = VariantId;

const formatDate = (date: Date) =>
	new Intl.DateTimeFormat("en-US", {
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	}).format(new Date(date));

const formatPercent = (value: number) => `${value.toFixed(2)}%`;

const formatTokens = (tokens: number) => {
	if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(1)}M`;
	if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}K`;
	return tokens.toString();
};

/**
 * Estimate cost based on token usage.
 * Using approximate OpenRouter pricing for Claude Sonnet 4.
 * Input: ~$3/1M tokens, Output: ~$15/1M tokens
 */
const estimateCost = (inputTokens: number, outputTokens: number): number => {
	const inputCost = (inputTokens / 1000000) * 3;
	const outputCost = (outputTokens / 1000000) * 15;
	return inputCost + outputCost;
};

const formatCost = (cost: number): string => {
	if (cost < 0.001) return "<$0.001";
	if (cost < 0.01) return `$${cost.toFixed(4)}`;
	return `$${cost.toFixed(3)}`;
};

function FailureCard({ failure }: { failure: FailureEntry }) {
	const [isOpen, setIsOpen] = useState(false);
	const modelInfo = getModelInfo(failure.modelName);

	// Parse response payload for more details
	const payload = failure.responsePayload as Record<string, unknown> | null;
	const prompt = (payload?.prompt as string) || null;
	const decisions = (payload?.decisions as unknown[]) || [];
	const executionResults = (payload?.executionResults as unknown[]) || [];

	// Find failed executions
	const failedExecutions = executionResults.filter(
		(r: unknown) => (r as { success?: boolean })?.success === false,
	);

	// Extract step telemetry
	const stepTelemetry = failure.stepTelemetry ?? [];
	const totalSteps = failure.totalSteps ?? stepTelemetry.length;
	const totalInputTokens = failure.totalInputTokens ?? 0;
	const totalOutputTokens = failure.totalOutputTokens ?? 0;
	const estimatedCost = estimateCost(totalInputTokens, totalOutputTokens);
	const hitMaxSteps = totalSteps >= 10; // Our stopWhen limit

	return (
		<Collapsible open={isOpen} onOpenChange={setIsOpen}>
			<Card className="mb-4">
				<CollapsibleTrigger asChild>
					<CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors">
						<div className="flex items-center justify-between">
							<div className="flex items-center gap-3">
								{modelInfo.logo ? (
									<img
										src={modelInfo.logo}
										alt={failure.modelName}
										className="h-8 w-8 rounded"
									/>
								) : (
									<div
										className="h-8 w-8 rounded flex items-center justify-center text-xs font-bold text-white"
										style={{ backgroundColor: modelInfo.color }}
									>
										{failure.modelName.slice(0, 2).toUpperCase()}
									</div>
								)}
								<div>
									<CardTitle className="text-base flex items-center gap-2">
										{failure.modelName}
										{failure.failureReason && (
											<Badge variant="destructive" className="text-xs">
												<AlertTriangle className="h-3 w-3 mr-1" />
												Classified
											</Badge>
										)}
										{hitMaxSteps && (
											<Badge variant="outline" className="text-xs text-orange-500 border-orange-500/50">
												<Clock className="h-3 w-3 mr-1" />
												Max Steps
											</Badge>
										)}
									</CardTitle>
									<CardDescription className="flex items-center gap-3">
										<span>{formatDate(failure.createdAt)}</span>
										<span>•</span>
										<span className="flex items-center gap-1">
											<Zap className="h-3 w-3" />
											{totalSteps} steps
										</span>
										<span>•</span>
										<span>{failure.toolCalls.length} tool calls</span>
										{(totalInputTokens > 0 || totalOutputTokens > 0) && (
											<>
												<span>•</span>
												<span className="flex items-center gap-1">
													<DollarSign className="h-3 w-3" />
													{formatCost(estimatedCost)}
												</span>
											</>
										)}
										{failedExecutions.length > 0 && (
											<span className="text-red-500">
												• {failedExecutions.length} failed
											</span>
										)}
									</CardDescription>
								</div>
							</div>
							<Button variant="ghost" size="sm">
								{isOpen ? (
									<ChevronDown className="h-4 w-4" />
								) : (
									<ChevronRight className="h-4 w-4" />
								)}
							</Button>
						</div>
					</CardHeader>
				</CollapsibleTrigger>
				<CollapsibleContent>
					<CardContent className="pt-0">
						{/* Step Telemetry Summary */}
						{stepTelemetry.length > 0 && (
							<div className="mb-4 p-3 rounded-lg bg-muted/50 border">
								<h4 className="font-semibold mb-2 flex items-center gap-2">
									<Zap className="h-4 w-4" />
									Execution Telemetry
								</h4>
								<div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
									<div>
										<span className="text-muted-foreground">Steps:</span>
										<span className={cn("ml-1 font-medium", hitMaxSteps && "text-orange-500")}>
											{totalSteps}{hitMaxSteps && " (limit)"}
										</span>
									</div>
									<div>
										<span className="text-muted-foreground">Input:</span>
										<span className="ml-1 font-medium">{formatTokens(totalInputTokens)}</span>
									</div>
									<div>
										<span className="text-muted-foreground">Output:</span>
										<span className="ml-1 font-medium">{formatTokens(totalOutputTokens)}</span>
									</div>
									<div>
										<span className="text-muted-foreground">Est. Cost:</span>
										<span className="ml-1 font-medium">{formatCost(estimatedCost)}</span>
									</div>
								</div>
								{/* Step breakdown */}
								<Collapsible className="mt-3">
									<CollapsibleTrigger asChild>
										<Button variant="outline" size="sm" className="w-full justify-start">
											<ChevronRight className="h-4 w-4 mr-2" />
											View Step Breakdown
										</Button>
									</CollapsibleTrigger>
									<CollapsibleContent className="mt-2">
										<div className="space-y-1 text-xs">
											{stepTelemetry.map((step) => (
												<div
													key={step.stepNumber}
													className="flex items-center justify-between p-2 rounded bg-background"
												>
													<div className="flex items-center gap-2">
														<Badge variant="outline" className="text-xs">
															Step {step.stepNumber}
														</Badge>
														{step.toolNames.length > 0 && (
															<span className="text-muted-foreground">
																{step.toolNames.join(", ")}
															</span>
														)}
													</div>
													<span className="text-muted-foreground">
														{formatTokens(step.inputTokens)} in / {formatTokens(step.outputTokens)} out
													</span>
												</div>
											))}
										</div>
									</CollapsibleContent>
								</Collapsible>
							</div>
						)}

						{/* Failure Reason */}
						{failure.failureReason && (
							<div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
								<h4 className="font-semibold text-red-500 mb-1 flex items-center gap-2">
									<AlertTriangle className="h-4 w-4" />
									AI Failure Analysis
								</h4>
								<p className="text-sm text-muted-foreground">
									{failure.failureReason}
								</p>
							</div>
						)}

						{/* Response */}
						<div className="mb-4">
							<h4 className="font-semibold mb-2">Model Response</h4>
							<pre className="text-sm bg-muted p-3 rounded-lg overflow-x-auto whitespace-pre-wrap max-h-40 overflow-y-auto">
								{failure.response || "(empty)"}
							</pre>
						</div>

						{/* Prompt (collapsed by default) */}
						{prompt && (
							<Collapsible className="mb-4">
								<CollapsibleTrigger asChild>
									<Button
										variant="outline"
										size="sm"
										className="mb-2 w-full justify-start"
									>
										<ChevronRight className="h-4 w-4 mr-2" />
										View Prompt
									</Button>
								</CollapsibleTrigger>
								<CollapsibleContent>
									<pre className="text-xs bg-muted p-3 rounded-lg overflow-x-auto whitespace-pre-wrap max-h-60 overflow-y-auto">
										{prompt}
									</pre>
								</CollapsibleContent>
							</Collapsible>
						)}

						{/* Tool Calls */}
						{failure.toolCalls.length > 0 && (
							<div className="mb-4">
								<h4 className="font-semibold mb-2">Tool Calls</h4>
								<div className="space-y-2">
									{failure.toolCalls.map((tc) => {
										let parsedMeta: Record<string, unknown> | null = null;
										try {
											parsedMeta = JSON.parse(tc.metadata);
										} catch {
											// Ignore
										}

										const results = (parsedMeta?.results as unknown[]) || [];
										const hasFailure = results.some(
											(r: unknown) =>
												(r as { success?: boolean })?.success === false,
										);

										return (
											<Collapsible key={tc.id}>
												<div
													className={cn(
														"p-3 rounded-lg border",
														hasFailure
															? "border-red-500/30 bg-red-500/5"
															: "border-border bg-muted/30",
													)}
												>
													<CollapsibleTrigger asChild>
														<div className="flex items-center justify-between cursor-pointer">
															<div className="flex items-center gap-2">
																<Badge
																	variant={
																		hasFailure ? "destructive" : "secondary"
																	}
																>
																	{tc.toolCallType}
																</Badge>
																<span className="text-xs text-muted-foreground">
																	{formatDate(tc.createdAt)}
																</span>
															</div>
															<ChevronRight className="h-4 w-4" />
														</div>
													</CollapsibleTrigger>
													<CollapsibleContent className="mt-2">
														<pre className="text-xs bg-background p-2 rounded overflow-x-auto whitespace-pre-wrap max-h-40 overflow-y-auto">
															{JSON.stringify(parsedMeta, null, 2)}
														</pre>
													</CollapsibleContent>
												</div>
											</Collapsible>
										);
									})}
								</div>
							</div>
						)}

						{/* Decisions Summary */}
						{decisions.length > 0 && (
							<div>
								<h4 className="font-semibold mb-2">
									Decisions ({decisions.length})
								</h4>
								<div className="text-xs text-muted-foreground">
									{decisions
										.map((d: unknown) => {
											const decision = d as {
												symbol?: string;
												side?: string;
											};
											return `${decision.symbol} ${decision.side}`;
										})
										.join(", ")}
								</div>
							</div>
						)}
					</CardContent>
				</CollapsibleContent>
			</Card>
		</Collapsible>
	);
}

function FailuresRoute() {
	const [showTotal, setShowTotal] = useState(false);
	const { selectedVariant, setSelectedVariant } = useVariant();
	const { data, isLoading, error } = useQuery(
		orpc.analytics.getFailures.queryOptions({
			input: { limit: 50, variant: selectedVariant as VariantFilter },
		}),
	);

	// Reset showTotal when switching away from aggregate view
	useEffect(() => {
		if (selectedVariant !== "all" && showTotal) {
			setShowTotal(false);
		}
	}, [selectedVariant, showTotal]);

	// Calculate totaled stats when "Total" is checked
	const displayModelStats = useMemo(() => {
		if (!data?.modelStats) return [];
		if (selectedVariant !== "all" || !showTotal) return data.modelStats;

		// Group by model name and sum the stats
		const byModelName = new Map<string, typeof data.modelStats>();
		for (const stat of data.modelStats) {
			const existing = byModelName.get(stat.modelName) ?? [];
			existing.push(stat);
			byModelName.set(stat.modelName, existing);
		}

		return Array.from(byModelName.entries()).map(([modelName, entries]) => {
			const totalWorkflow = entries.reduce((sum, e) => sum + e.failedWorkflowCount, 0);
			const totalToolCall = entries.reduce((sum, e) => sum + e.failedToolCallCount, 0);
			const totalInvocations = entries.reduce((sum, e) => sum + e.invocationCount, 0);
			return {
				modelId: entries[0].modelId,
				modelName,
				variant: "TOTAL",
				failedWorkflowCount: totalWorkflow,
				failedToolCallCount: totalToolCall,
				invocationCount: totalInvocations,
				failureRate:
					totalInvocations > 0
						? ((totalWorkflow + totalToolCall) / totalInvocations) * 100
						: 0,
			};
		});
	}, [data?.modelStats, selectedVariant, showTotal]);

	return (
		<div className="flex-1 min-h-0 overflow-hidden">
			<div className="mx-auto h-full max-w-6xl overflow-auto p-6 md:p-10 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
				{/* Header */}
				<div className="mb-6 md:mb-10 flex flex-col gap-3 md:gap-4 md:flex-row md:items-center md:justify-between">
					<div className="space-y-1">
						<h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">
							Failures
						</h1>
						<p className="text-muted-foreground mt-1">
							Recent workflow and tool call failures with detailed analysis.
						</p>
					</div>
					<div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:gap-3">
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
						{selectedVariant === "all" && (
							<div className="flex items-center gap-2">
								<Checkbox
									id="total-failures"
									checked={showTotal}
									onCheckedChange={(checked) => setShowTotal(checked === true)}
								/>
								<label
									htmlFor="total-failures"
									className="text-sm font-medium cursor-pointer"
								>
									TOTAL
								</label>
							</div>
						)}
					</div>
				</div>

				{/* Model Failure Stats Summary */}
				{displayModelStats.length > 0 && (
					<div className="mb-8">
						<h2 className="text-lg font-semibold mb-4">
							Model Failure Statistics
						</h2>
						<div className="rounded-xl overflow-hidden border bg-card">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Model</TableHead>
										{selectedVariant === "all" && !showTotal && (
											<TableHead>Variant</TableHead>
										)}
										<TableHead className="text-right">
											Failed Workflows
										</TableHead>
										<TableHead className="text-right">
											Failed Tool Calls
										</TableHead>
										<TableHead className="text-right">
											Total Invocations
										</TableHead>
										<TableHead className="text-right">Failure Rate</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{displayModelStats.map((stat) => {
										const modelInfo = getModelInfo(stat.modelName);
										return (
											<TableRow key={`${stat.modelId}-${stat.variant}`}>
												<TableCell className="font-medium">
													<div className="flex items-center gap-2">
														{modelInfo.logo ? (
															<img
																src={modelInfo.logo}
																alt={stat.modelName}
																className="h-5 w-5 rounded"
															/>
														) : (
															<div
																className="h-5 w-5 rounded flex items-center justify-center text-[8px] font-bold text-white"
																style={{ backgroundColor: modelInfo.color }}
															>
																{stat.modelName.slice(0, 2).toUpperCase()}
															</div>
														)}
														{stat.modelName}
													</div>
												</TableCell>
												{selectedVariant === "all" && !showTotal && (
													<TableCell>
														<span className={cn(
															"px-2 py-0.5 rounded text-xs font-medium",
															stat.variant === "OG" && "bg-green-500/20 text-green-500",
															stat.variant === "Minimal" && "bg-blue-500/20 text-blue-500",
															stat.variant === "Verbose" && "bg-purple-500/20 text-purple-500",
															stat.variant === "AGI" && "bg-amber-500/20 text-amber-500",
														)}>
															{stat.variant}
														</span>
													</TableCell>
												)}
												<TableCell className="text-right">
													<span
														className={cn(
															stat.failedWorkflowCount > 0 && "text-red-500",
														)}
													>
														{stat.failedWorkflowCount}
													</span>
												</TableCell>
												<TableCell className="text-right">
													<span
														className={cn(
															stat.failedToolCallCount > 0 && "text-yellow-500",
														)}
													>
														{stat.failedToolCallCount}
													</span>
												</TableCell>
												<TableCell className="text-right">
													{stat.invocationCount}
												</TableCell>
												<TableCell className="text-right">
													<span
														className={cn(
															stat.failureRate > 10
																? "text-red-500"
																: stat.failureRate > 5
																	? "text-yellow-500"
																	: "text-muted-foreground",
														)}
													>
														{formatPercent(stat.failureRate)}
													</span>
												</TableCell>
											</TableRow>
										);
									})}
								</TableBody>
							</Table>
						</div>
					</div>
				)}

				{/* Recent Failures */}
				<div>
					<h2 className="text-lg font-semibold mb-4">Recent Failures</h2>
					{isLoading ? (
						<div className="flex h-64 items-center justify-center">
							<Loader2 className="h-8 w-8 animate-spin" />
						</div>
					) : error ? (
						<div className="p-6 text-sm text-red-500">
							Failed to load failures: {error.message}
						</div>
					) : !data?.failures?.length ? (
						<div className="flex h-64 items-center justify-center">
							<p className="text-muted-foreground">
								No failures detected. All systems nominal! 🎉
							</p>
						</div>
					) : (
						<div>
							{data.failures.map((failure) => (
								<FailureCard key={failure.invocationId} failure={failure} />
							))}
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
