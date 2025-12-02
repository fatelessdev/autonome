import { QueryClient } from "@tanstack/react-query";
import {
	createPortfolioSnapshotMutation,
	listModelsQuery,
	portfolioHistoryQuery,
} from "@/server/db/tradingRepository.server";
import { portfolioQuery } from "@/server/features/trading/getPortfolio.server";
import { INITIAL_CAPITAL } from "@/core/shared/trading/calculations";

const PORTFOLIO_INTERVAL_MS = 1000 * 60 * 1;

declare global {
	var __portfolioSchedulerInitialized: boolean | undefined;
	var __portfolioIntervalHandle: ReturnType<typeof setInterval> | undefined;
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
}

async function recordPortfolios() {
	const queryClient = new QueryClient();

	const models = await queryClient.fetchQuery(listModelsQuery());

	for (const model of models) {
		try {
			// Check if this model has any portfolio history
			const existingHistory = await queryClient.fetchQuery(
				portfolioHistoryQuery(model.id),
			);

			// If no history exists, seed with initial 10k starting point
			if (existingHistory.length === 0) {
				await createPortfolioSnapshotMutation({
					modelId: model.id,
					netPortfolio: String(INITIAL_CAPITAL),
				});
				console.log(
					`[Portfolio Tracker] Seeded initial ${INITIAL_CAPITAL} for ${model.name}`,
				);
			}

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

			if (
				portfolio?.total &&
				!Number.isNaN(Number.parseFloat(portfolio.total))
			) {
				await createPortfolioSnapshotMutation({
					modelId: model.id,
					netPortfolio: portfolio.total,
				});
				await queryClient.invalidateQueries({
					queryKey: ["portfolio-history", model.id],
				});
			} else {
				console.warn(
					`[Portfolio Tracker] Invalid portfolio data for ${model.name}:`,
					portfolio,
				);
			}
		} catch (error) {
			console.error(
				`[Portfolio Tracker] Error recording portfolio for ${model.name}:`,
				error,
			);
		}
	}
}
