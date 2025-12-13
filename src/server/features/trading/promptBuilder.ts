import type { Account } from "@/server/features/trading/accounts";
import type { PortfolioSnapshot } from "@/server/features/trading/getPortfolio";
import type {
	EnrichedOpenPosition,
	ExposureSummary,
} from "@/server/features/trading/openPositionEnrichment";
import type { PerformanceMetrics } from "@/server/features/trading/performanceMetrics";
import {
	type VariantId,
	DEFAULT_VARIANT,
	getVariantConfig,
} from "@/server/features/trading/prompts/variants";
import type { CompetitionSnapshot } from "@/server/features/trading/competitionSnapshot";
import {
	buildOpenPositionsSection,
	buildPerformanceOverview,
	buildPortfolioSnapshotSection,
	calculateExposureToEquityPct,
	formatUsd,
} from "@/server/features/trading/promptSections";
import { SUPPORTED_MARKETS } from "@/core/shared/markets/marketMetadata";

interface TradingPromptParams {
	account: Account;
	portfolio: PortfolioSnapshot;
	openPositions: EnrichedOpenPosition[];
	exposureSummary: ExposureSummary;
	performanceMetrics: PerformanceMetrics;
	marketIntelligence: string;
	currentTime: string;
	/** Strategy variant - determines which prompt set to use */
	variant?: VariantId;
	/** Per-symbol action counts for session limit tracking */
	symbolActionCounts?: Map<string, number>;
	/** Leaderboard context */
	competition?: CompetitionSnapshot;
}

/**
 * Build both system and user prompts for the trading agent.
 * System prompt contains static instructions (hidden from model context).
 * User prompt contains dynamic session data.
 */
export function buildTradingPrompts(params: TradingPromptParams): {
	systemPrompt: string;
	userPrompt: string;
	variantId: VariantId;
} {
	const {
		account,
		portfolio,
		openPositions,
		exposureSummary,
		performanceMetrics,
		marketIntelligence,
		currentTime,
		variant = DEFAULT_VARIANT,
		symbolActionCounts,
		competition,
	} = params;

	// Get variant-specific prompts
	const variantConfig = getVariantConfig(variant);
	const SYSTEM_PROMPT = variantConfig.systemPrompt;
	const USER_PROMPT = variantConfig.userPrompt;

	const exposureRatio = calculateExposureToEquityPct(portfolio, exposureSummary);
	const exposurePercentLabel =
		exposureRatio != null && Number.isFinite(exposureRatio)
			? exposureRatio.toFixed(1)
			: "0.0";
	const availableCashLabel = formatUsd(portfolio.availableCash);

	// Calculate risk to equity percentage for prompts that use it
	const riskToEquityPct =
		portfolio.totalValue > 0 && exposureSummary.totalRiskUsd > 0
			? ((exposureSummary.totalRiskUsd / portfolio.totalValue) * 100).toFixed(2)
			: "0.00";

	// TODO: Re-enable symbol action counts later
	// Build symbol action count string from actual counts
	// const symbolActionCount = SUPPORTED_MARKETS.map((symbol) => {
	// 	const count = symbolActionCounts?.get(symbol) ?? 0;
	// 	return `${symbol}: ${count}`;
	// }).join(", ");

	const userPrompt = USER_PROMPT.replaceAll(
		"{{INVOKATION_TIMES}}",
		account.invocationCount.toString(),
	)
		.replaceAll("{{CURRENT_TIME}}", currentTime)
		.replaceAll("{{TOTAL_MINUTES}}", account.totalMinutes.toString())
		.replaceAll("{{AVAILABLE_CASH}}", availableCashLabel)
		.replaceAll("{{EXPOSURE_TO_EQUITY_PCT}}", exposurePercentLabel)
		.replaceAll("{{RISK_TO_EQUITY_PCT}}", riskToEquityPct)
		// .replaceAll("{{SYMBOL_ACTION_COUNT}}", symbolActionCount)
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
		)
		.replaceAll(
			"{{COMPETITION_STANDINGS}}",
			competition?.standings ?? "No leaderboard data",
		)
		.replaceAll(
			"{{COMPETITION_PNL_DELTA}}",
			competition?.pnlDeltaToLeader ?? "N/A",
		);

	return {
		systemPrompt: SYSTEM_PROMPT,
		userPrompt,
		variantId: variant,
	};
}

/**
 * @deprecated Use buildTradingPrompts() for system/user split
 * Kept for backward compatibility - returns combined prompt
 */
export function buildTradingPrompt(params: TradingPromptParams): string {
	const { systemPrompt, userPrompt } = buildTradingPrompts(params);
	return `${systemPrompt}\n\n${userPrompt}`;
}
