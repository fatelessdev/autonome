import type { Account } from "@/server/features/trading/accounts";
import type { PortfolioSnapshot } from "@/server/features/trading/getPortfolio";
import type {
	EnrichedOpenPosition,
	ExposureSummary,
} from "@/server/features/trading/openPositionEnrichment";
import type { PerformanceMetrics } from "@/server/features/trading/performanceMetrics";
import { PROMPT } from "@/server/features/trading/prompt";
import {
	buildOpenPositionsSection,
	buildPerformanceOverview,
	buildPortfolioSnapshotSection,
	formatUsd,
} from "@/server/features/trading/promptSections";

export function buildTradingPrompt({
	account,
	portfolio,
	openPositions,
	exposureSummary,
	performanceMetrics,
	marketIntelligence,
	currentTime,
}: {
	account: Account;
	portfolio: PortfolioSnapshot;
	openPositions: EnrichedOpenPosition[];
	exposureSummary: ExposureSummary;
	performanceMetrics: PerformanceMetrics;
	marketIntelligence: string;
	currentTime: string;
}): string {
	const exposureRatio =
		portfolio.totalValue > 0
			? (exposureSummary.totalNotional / portfolio.totalValue) * 100
			: 0;
	const exposurePercentLabel = Number.isFinite(exposureRatio)
		? exposureRatio.toFixed(1)
		: "0.0";
	const availableCashLabel = formatUsd(portfolio.availableCash);

	return PROMPT.replaceAll(
		"{{INVOKATION_TIMES}}",
		account.invocationCount.toString(),
	)
		.replaceAll("{{CURRENT_TIME}}", currentTime)
		.replaceAll("{{TOTAL_MINUTES}}", account.totalMinutes.toString())
		.replaceAll("{{AVAILABLE_CASH}}", availableCashLabel)
		.replaceAll("{{EXPOSURE_TO_EQUITY_PCT}}", exposurePercentLabel)
		.replaceAll("{{MARKET_INTELLIGENCE}}", marketIntelligence)
		.replaceAll(
			"{{PORTFOLIO_SNAPSHOT}}",
			buildPortfolioSnapshotSection({
				portfolio,
				openPositions,
				exposureSummary,
			}),
		)
		.replaceAll(
			"{{OPEN_POSITIONS_TABLE}}",
			buildOpenPositionsSection(openPositions),
		)
		.replaceAll(
			"{{PERFORMANCE_OVERVIEW}}",
			buildPerformanceOverview({
				account,
				portfolio,
				performanceMetrics,
				openPositions,
				exposureSummary,
			}),
		);
}
