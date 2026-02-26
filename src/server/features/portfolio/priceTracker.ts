/**
 * Portfolio Price Tracker
 *
 * Records periodic portfolio snapshots for every model.
 * Designed to be called from a Workflow DevKit step (no more setInterval).
 * Also runs retention policy to downsample old data.
 */

import { QueryClient } from "@tanstack/react-query";
import { sql } from "drizzle-orm";
import { INITIAL_CAPITAL } from "@/core/shared/trading/calculations";
import { db } from "@/db";
import { models, portfolioSize } from "@/db/schema";
import { createPortfolioSnapshotMutation } from "@/server/db/tradingRepository.server";
import { emitPortfolioEvent } from "@/server/features/portfolio/events/portfolioEvents";
import { runRetentionPolicy } from "@/server/features/portfolio/retentionService";
import type { Account } from "@/server/features/trading/contracts/accounts";
import { portfolioQuery } from "@/server/features/trading/data/portfolio.server";

declare global {
	var __portfolioQueryClient: QueryClient | undefined;
}

/**
 * Get or create a singleton QueryClient for server-side portfolio fetching.
 */
function getPortfolioFetchClient(): QueryClient {
	if (!globalThis.__portfolioQueryClient) {
		globalThis.__portfolioQueryClient = new QueryClient({
			defaultOptions: {
				queries: {
					staleTime: 30_000,
					gcTime: 5 * 60_000,
				},
			},
		});
	}
	return globalThis.__portfolioQueryClient;
}

/**
 * Run the retention policy job to downsample old portfolio data.
 */
export async function runRetentionPolicyJob() {
	try {
		const result = await runRetentionPolicy();
		console.log(
			`[Portfolio Retention] Completed: ${result.hourlyAggregatesCreated} hourly, ${result.dailyAggregatesCreated} daily created, ${result.rawRecordsDeleted} raw deleted`,
		);
	} catch (error) {
		console.error(
			"[Portfolio Retention] Error running retention policy:",
			error,
		);
	}
}

/**
 * Record portfolio snapshots for all models.
 * Called from the Workflow DevKit trade cycle step (replaces the old setInterval scheduler).
 */
export async function recordPortfolios() {
	const queryClient = getPortfolioFetchClient();

	// Batch fetch all models in one query
	const allModels = await db.select().from(models);

	if (allModels.length === 0) return;

	// Batch check which models need initial seeding
	const modelIds = allModels.map((m) => m.id);
	const existingCounts = await db
		.select({
			modelId: portfolioSize.modelId,
			count: sql<number>`count(*)`.as("count"),
		})
		.from(portfolioSize)
		.where(
			sql`${portfolioSize.modelId} IN (${sql.join(
				modelIds.map((id) => sql`${id}`),
				sql`, `,
			)})`,
		)
		.groupBy(portfolioSize.modelId);

	const countByModelId = new Map(
		existingCounts.map((e) => [e.modelId, Number(e.count)]),
	);

	// Seed initial capital for models without history
	const modelsNeedingSeeding = allModels.filter(
		(m) => !countByModelId.has(m.id) || countByModelId.get(m.id) === 0,
	);
	if (modelsNeedingSeeding.length > 0) {
		await Promise.all(
			modelsNeedingSeeding.map(async (model) => {
				await createPortfolioSnapshotMutation({
					modelId: model.id,
					netPortfolio: String(INITIAL_CAPITAL),
				});
				console.log(
					`[Portfolio Tracker] Seeded initial ${INITIAL_CAPITAL} for ${model.name}`,
				);
			}),
		);
	}

	// Build Account objects and fetch portfolios in parallel
	const portfolioResults = await Promise.all(
		allModels
			.filter((model) => model.alpacaApiKey && model.alpacaApiSecret)
			.map(async (model) => {
				try {
					const account: Account = {
						alpacaApiKey: model.alpacaApiKey,
						alpacaApiSecret: model.alpacaApiSecret,
						name: model.name,
						modelName: model.openRouterModelName,
						invocationCount: model.invocationCount,
						id: model.id,
						totalMinutes: model.totalMinutes,
					};
					const portfolio = await queryClient.fetchQuery(
						portfolioQuery(account),
					);
					return { model, portfolio, error: null };
				} catch (error) {
					return { model, portfolio: null, error };
				}
			}),
	);

	// Batch create snapshots for valid portfolios
	const validSnapshots = portfolioResults
		.filter(
			(
				item,
			): item is typeof item & {
				portfolio: NonNullable<typeof item.portfolio>;
			} =>
				Boolean(
					item.portfolio?.total &&
						!Number.isNaN(Number.parseFloat(item.portfolio.total)),
				),
		)
		.map(({ model, portfolio }) => ({
			modelId: model.id,
			netPortfolio: portfolio.total,
		}));

	await Promise.all(
		validSnapshots.map(({ modelId, netPortfolio }) =>
			createPortfolioSnapshotMutation({ modelId, netPortfolio }),
		),
	);

	// Emit SSE event to notify clients
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
			console.error(
				`[Portfolio Tracker] Error recording portfolio for ${model.name}:`,
				error,
			);
		}
	}
}
