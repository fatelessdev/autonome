import { sql } from "drizzle-orm";
import { db } from "@/db";
import { models, portfolioSize } from "@/db/schema";
import { createPortfolioSnapshotMutation } from "@/server/db/tradingRepository.server";
import { portfolioQuery } from "@/server/features/trading/getPortfolio.server";
import { runRetentionPolicy } from "@/server/features/portfolio/retentionService";
import { INITIAL_CAPITAL } from "@/core/shared/trading/calculations";
import { emitPortfolioEvent } from "@/server/features/portfolio/events/portfolioEvents";
import { QueryClient } from "@tanstack/react-query";

const PORTFOLIO_INTERVAL_MS = 1000 * 60 * 1; // 1 minute
const RETENTION_INTERVAL_MS = 1000 * 60 * 60; // 1 hour

declare global {
	var __portfolioSchedulerInitialized: boolean | undefined;
	var __portfolioIntervalHandle: ReturnType<typeof setInterval> | undefined;
	var __retentionIntervalHandle: ReturnType<typeof setInterval> | undefined;
	var __portfolioQueryClient: QueryClient | undefined;
}

/**
 * Get or create a singleton QueryClient for server-side portfolio fetching.
 * Used only to cache portfolio API calls within the scheduler, NOT for client invalidation.
 */
function getPortfolioFetchClient(): QueryClient {
	if (!globalThis.__portfolioQueryClient) {
		globalThis.__portfolioQueryClient = new QueryClient({
			defaultOptions: {
				queries: {
					staleTime: 30_000, // 30 seconds
					gcTime: 5 * 60_000, // 5 minutes
				},
			},
		});
	}
	return globalThis.__portfolioQueryClient;
}

export function ensurePortfolioScheduler() {
	// Double-check guard to prevent duplicate schedulers
	if (globalThis.__portfolioSchedulerInitialized || globalThis.__portfolioIntervalHandle) {
		return;
	}

	globalThis.__portfolioSchedulerInitialized = true;

	void recordPortfolios();

	globalThis.__portfolioIntervalHandle = setInterval(() => {
		void recordPortfolios();
	}, PORTFOLIO_INTERVAL_MS);

	// Run retention policy hourly
	globalThis.__retentionIntervalHandle = setInterval(() => {
		void runRetentionPolicyJob();
	}, RETENTION_INTERVAL_MS);

	// Run retention on startup (after a delay to not block initialization)
	setTimeout(() => {
		void runRetentionPolicyJob();
	}, 60_000); // 1 minute after startup
}

async function runRetentionPolicyJob() {
	try {
		const result = await runRetentionPolicy();
		console.log(
			`[Portfolio Retention] Completed: ${result.hourlyAggregatesCreated} hourly, ${result.dailyAggregatesCreated} daily created, ${result.rawRecordsDeleted} raw deleted`,
		);
	} catch (error) {
		console.error("[Portfolio Retention] Error running retention policy:", error);
	}
}

async function recordPortfolios() {
	const queryClient = getPortfolioFetchClient();

	// Batch fetch all models in one query (fixes N+1)
	const allModels = await db.select().from(models);

	// Batch check which models need initial seeding
	const modelIds = allModels.map((m) => m.id);
	const existingCounts = await db
		.select({
			modelId: portfolioSize.modelId,
			count: sql<number>`count(*)`.as("count"),
		})
		.from(portfolioSize)
		.where(sql`${portfolioSize.modelId} IN (${sql.join(modelIds.map(id => sql`${id}`), sql`, `)})`)
		.groupBy(portfolioSize.modelId);

	const countByModelId = new Map(existingCounts.map((e) => [e.modelId, Number(e.count)]));

	// Seed initial capital for models without history
	const modelsNeedingSeeding = allModels.filter((m) => !countByModelId.has(m.id) || countByModelId.get(m.id) === 0);
	if (modelsNeedingSeeding.length > 0) {
		await Promise.all(
			modelsNeedingSeeding.map(async (model) => {
				await createPortfolioSnapshotMutation({
					modelId: model.id,
					netPortfolio: String(INITIAL_CAPITAL),
				});
				console.log(`[Portfolio Tracker] Seeded initial ${INITIAL_CAPITAL} for ${model.name}`);
			}),
		);
	}

	// Batch fetch all portfolios in parallel (fixes N+1)
	const portfolioResults = await Promise.all(
		allModels.map(async (model) => {
			try {
				const portfolio = await queryClient.fetchQuery(
					portfolioQuery({
						apiKey: model.lighterApiKey,
						modelName: model.openRouterModelName,
						name: model.name,
						invocationCount: model.invocationCount,
						id: model.id,
						accountIndex: model.accountIndex,
						totalMinutes: model.totalMinutes,
					}),
				);
				return { model, portfolio, error: null };
			} catch (error) {
				return { model, portfolio: null, error };
			}
		}),
	);

	// Batch create snapshots for valid portfolios
	const validSnapshots = portfolioResults
		.filter(({ portfolio }) => portfolio?.total && !Number.isNaN(Number.parseFloat(portfolio.total)))
		.map(({ model, portfolio }) => ({
			modelId: model.id,
			netPortfolio: portfolio!.total,
		}));

	// Create snapshots in parallel (could batch insert in future)
	await Promise.all(
		validSnapshots.map(({ modelId, netPortfolio }) =>
			createPortfolioSnapshotMutation({ modelId, netPortfolio }),
		),
	);

	// Emit SSE event to notify clients that portfolio data has changed
	// This triggers client-side query invalidation for real-time updates
	emitPortfolioEvent({
		type: "portfolio:updated",
		timestamp: new Date().toISOString(),
		data: {
			modelsUpdated: validSnapshots.length,
			snapshotsCreated: validSnapshots.length,
		},
	});

	// Log errors
	for (const { model, error } of portfolioResults) {
		if (error) {
			console.error(`[Portfolio Tracker] Error recording portfolio for ${model.name}:`, error);
		}
	}
}
