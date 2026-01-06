import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/core/lib/utils";

export const Route = createFileRoute("/health")({
	component: HealthRoute,
});

type SchedulerHealth = {
	healthy: boolean;
	lastRun: string | null;
	ageMs: number | null;
};

type RunningModel = {
	id: string;
	runningForSeconds: number | null;
};

type HealthResponse = {
	status: "ok" | "degraded";
	timestamp: string;
	schedulers: {
		trade: SchedulerHealth;
		portfolio: SchedulerHealth;
	};
};

type DetailedHealthResponse = {
	timestamp: string;
	tradeScheduler: {
		lastRun: string | null;
		ageSeconds: number | null;
		modelsCurrentlyRunning: RunningModel[];
		intervalHandle: boolean;
	};
	portfolioScheduler: {
		lastRun: string | null;
		ageSeconds: number | null;
		intervalHandle: boolean;
		initialized: boolean;
	};
};

async function fetchHealth(): Promise<HealthResponse> {
	const res = await fetch("/api/health");
	if (!res.ok) throw new Error("Failed to fetch health");
	return res.json();
}

async function fetchDetailedHealth(): Promise<DetailedHealthResponse> {
	const res = await fetch("/api/health/schedulers");
	if (!res.ok) throw new Error("Failed to fetch detailed health");
	return res.json();
}

function HealthRoute() {
	const healthQuery = useQuery({
		queryKey: ["health"],
		queryFn: fetchHealth,
		refetchInterval: 5_000, // Refresh every 5 seconds
	});

	const detailedQuery = useQuery({
		queryKey: ["health", "schedulers"],
		queryFn: fetchDetailedHealth,
		refetchInterval: 5_000,
	});

	const health = healthQuery.data;
	const detailed = detailedQuery.data;

	return (
		<div className="min-h-screen bg-background p-6">
			<div className="mx-auto max-w-4xl space-y-6">
				<div className="flex items-center justify-between">
					<h1 className="text-3xl font-bold">System Health</h1>
					{health && (
						<Badge
							variant={health.status === "ok" ? "default" : "destructive"}
							className={cn(
								"text-sm px-3 py-1",
								health.status === "ok" && "bg-green-600 hover:bg-green-700"
							)}
						>
							{health.status === "ok" ? "✓ Healthy" : "⚠ Degraded"}
						</Badge>
					)}
				</div>

				{healthQuery.isLoading && (
					<p className="text-muted-foreground">Loading health status...</p>
				)}

				{healthQuery.isError && (
					<Card className="border-destructive">
						<CardHeader>
							<CardTitle className="text-destructive">Connection Error</CardTitle>
							<CardDescription>
								Unable to connect to the API server. Is the backend running?
							</CardDescription>
						</CardHeader>
					</Card>
				)}

				{health && detailed && (
					<div className="grid gap-6 md:grid-cols-2">
						{/* Trade Scheduler */}
						<Card>
							<CardHeader>
								<div className="flex items-center justify-between">
									<CardTitle>Trade Scheduler</CardTitle>
									<Badge
										variant={health.schedulers.trade.healthy ? "default" : "destructive"}
										className={cn(
											health.schedulers.trade.healthy && "bg-green-600 hover:bg-green-700"
										)}
									>
										{health.schedulers.trade.healthy ? "Healthy" : "Unhealthy"}
									</Badge>
								</div>
								<CardDescription>
									Executes model trade workflows every 5 minutes
								</CardDescription>
							</CardHeader>
							<CardContent className="space-y-4">
								<div className="space-y-2 text-sm">
									<div className="flex justify-between">
										<span className="text-muted-foreground">Last Run:</span>
										<span className="font-mono">
											{detailed.tradeScheduler.lastRun
												? new Date(detailed.tradeScheduler.lastRun).toLocaleTimeString()
												: "Never"}
										</span>
									</div>
									<div className="flex justify-between">
										<span className="text-muted-foreground">Age:</span>
										<span className="font-mono">
											{detailed.tradeScheduler.ageSeconds != null
												? `${detailed.tradeScheduler.ageSeconds}s ago`
												: "N/A"}
										</span>
									</div>
									<div className="flex justify-between">
										<span className="text-muted-foreground">Interval Handle:</span>
										<span className={detailed.tradeScheduler.intervalHandle ? "text-green-500" : "text-red-500"}>
											{detailed.tradeScheduler.intervalHandle ? "Active" : "Missing"}
										</span>
									</div>
								</div>

								{detailed.tradeScheduler.modelsCurrentlyRunning.length > 0 && (
									<div className="border-t pt-4">
										<p className="mb-2 text-sm font-medium">Models Currently Running:</p>
										<div className="space-y-1">
											{detailed.tradeScheduler.modelsCurrentlyRunning.map((model) => (
												<div
													key={model.id}
													className="flex items-center justify-between rounded bg-muted px-2 py-1 text-xs"
												>
													<span className="font-mono truncate max-w-[180px]">{model.id}</span>
													<span className={cn(
														"font-mono",
														model.runningForSeconds && model.runningForSeconds > 120 && "text-yellow-500",
														model.runningForSeconds && model.runningForSeconds > 300 && "text-orange-500",
														model.runningForSeconds && model.runningForSeconds > 600 && "text-red-500"
													)}>
														{model.runningForSeconds != null ? `${model.runningForSeconds}s` : "?"}
													</span>
												</div>
											))}
										</div>
									</div>
								)}
							</CardContent>
						</Card>

						{/* Portfolio Scheduler */}
						<Card>
							<CardHeader>
								<div className="flex items-center justify-between">
									<CardTitle>Portfolio Scheduler</CardTitle>
									<Badge
										variant={health.schedulers.portfolio.healthy ? "default" : "destructive"}
										className={cn(
											health.schedulers.portfolio.healthy && "bg-green-600 hover:bg-green-700"
										)}
									>
										{health.schedulers.portfolio.healthy ? "Healthy" : "Unhealthy"}
									</Badge>
								</div>
								<CardDescription>
									Records portfolio snapshots every 1 minute
								</CardDescription>
							</CardHeader>
							<CardContent className="space-y-2 text-sm">
								<div className="flex justify-between">
									<span className="text-muted-foreground">Last Run:</span>
									<span className="font-mono">
										{detailed.portfolioScheduler.lastRun
											? new Date(detailed.portfolioScheduler.lastRun).toLocaleTimeString()
											: "Never"}
									</span>
								</div>
								<div className="flex justify-between">
									<span className="text-muted-foreground">Age:</span>
									<span className="font-mono">
										{detailed.portfolioScheduler.ageSeconds != null
											? `${detailed.portfolioScheduler.ageSeconds}s ago`
											: "N/A"}
									</span>
								</div>
								<div className="flex justify-between">
									<span className="text-muted-foreground">Initialized:</span>
									<span className={detailed.portfolioScheduler.initialized ? "text-green-500" : "text-red-500"}>
										{detailed.portfolioScheduler.initialized ? "Yes" : "No"}
									</span>
								</div>
								<div className="flex justify-between">
									<span className="text-muted-foreground">Interval Handle:</span>
									<span className={detailed.portfolioScheduler.intervalHandle ? "text-green-500" : "text-red-500"}>
										{detailed.portfolioScheduler.intervalHandle ? "Active" : "Missing"}
									</span>
								</div>
							</CardContent>
						</Card>
					</div>
				)}

				{/* Timestamp */}
				{health && (
					<p className="text-center text-xs text-muted-foreground">
						Last updated: {new Date(health.timestamp).toLocaleString()}
						{" · "}
						Auto-refreshes every 5 seconds
					</p>
				)}
			</div>
		</div>
	);
}
