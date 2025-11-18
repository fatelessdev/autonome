import { QueryClient } from "@tanstack/react-query";
import {
	createPortfolioSnapshotMutation,
	listModelsQuery,
} from "@/server/db/tradingRepository.server";
import { portfolioQuery } from "@/server/features/trading/getPortfolio.server";

const PORTFOLIO_INTERVAL_MS = 1000 * 60 * 1;

declare global {
	var portfolioIntervalHandle: ReturnType<typeof setInterval> | undefined;
}

export function ensurePortfolioScheduler() {
	if (globalThis.portfolioIntervalHandle) {
		return;
	}

	void recordPortfolios();

	globalThis.portfolioIntervalHandle = setInterval(() => {
		void recordPortfolios();
	}, PORTFOLIO_INTERVAL_MS);
}

async function recordPortfolios() {
	const queryClient = new QueryClient();

	console.log("[Portfolio Tracker] Recording portfolios...");
	const models = await queryClient.fetchQuery(listModelsQuery());
	console.log(`[Portfolio Tracker] Found ${models.length} models`);

	for (const model of models) {
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
				console.log(
					`[Portfolio Tracker] ✓ Recorded ${model.name}: $${portfolio.total}`,
				);
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
