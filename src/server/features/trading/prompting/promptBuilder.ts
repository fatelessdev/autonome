import { toFiniteNumber } from "@/core/shared/trading/calculations";
import type { CompetitionSnapshot } from "@/server/features/trading/analysis/competitionSnapshot";
import type { PerformanceMetrics } from "@/server/features/trading/analysis/performanceMetrics";
import type { Account } from "@/server/features/trading/contracts/accounts";
import type {
	EnrichedOpenPosition,
	ExposureSummary,
} from "@/server/features/trading/data/openPositionEnrichment";
import type { PortfolioSnapshot } from "@/server/features/trading/data/portfolio";
import {
	buildOpenPositionsSection,
	buildPerformanceOverview,
	buildPortfolioSnapshotSection,
	calculateExposureToEquityPct,
	formatUsd,
} from "@/server/features/trading/prompting/promptSections";
import {
	DEFAULT_VARIANT,
	type VariantId,
} from "@/core/shared/variants";
import {
	getVariantConfig,
} from "@/server/features/trading/prompting/prompts/variants";

interface TradingPromptParams {
	account: Account;
	portfolio: PortfolioSnapshot;
	openPositions: EnrichedOpenPosition[];
	exposureSummary: ExposureSummary;
	performanceMetrics: PerformanceMetrics;
	marketIntelligence: string;
	/** Formatted news digest from Alpaca News API */
	newsDigest: string;
	currentTime: string;
	/** Strategy variant - determines which prompt set to use */
	variant?: VariantId;
	/** Per-symbol action counts for session limit tracking */
	symbolActionCounts?: Map<string, number>;
	/** Leaderboard context */
	competition: CompetitionSnapshot;
}

function renderPromptTemplate(
	template: string,
	placeholders: Record<string, string>,
): string {
	return template.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_fullToken, tokenName) => {
		const key = `{{${tokenName}}}`;
		const replacement = placeholders[key];
		if (replacement === undefined) {
			throw new Error(`Missing prompt placeholder value for ${key}`);
		}
		return replacement;
	});
}

/**
 * Build a compact state summary for prepareStep updates.
 * This is appended as a new message instead of rewriting the original prompt,
 * preserving conversation causality.
 */
export function buildStateSummary(params: {
	portfolio: PortfolioSnapshot;
	openPositions: EnrichedOpenPosition[];
	exposureSummary: ExposureSummary;
}): string {
	const { portfolio, openPositions, exposureSummary } = params;

	const exposureRatio = calculateExposureToEquityPct(
		portfolio,
		exposureSummary,
	);
	const exposurePct =
		exposureRatio != null && Number.isFinite(exposureRatio)
			? exposureRatio.toFixed(1)
			: "N/A";

	// Preserve unknowns explicitly rather than coercing missing values to zero.
	const positionSummaries = openPositions.map((pos) => {
		const pnlValue = toFiniteNumber(pos.unrealizedPnl);
		const entryValue = toFiniteNumber(pos.entryPrice);
		const pnlLabel =
			pnlValue === null
				? "N/A"
				: `${pnlValue >= 0 ? "+" : ""}$${pnlValue.toFixed(2)}`;
		const entryLabel = entryValue === null ? "N/A" : entryValue.toFixed(2);
		return `${pos.symbol} ${pos.side} @ ${entryLabel} (${pnlLabel})`;
	});

	const positionsLine =
		positionSummaries.length > 0
			? `Open: ${positionSummaries.join(", ")}`
			: "No open positions";

	return `[STATE UPDATE] Cash: ${formatUsd(portfolio.availableCash)} | Exposure: ${exposurePct}% | Portfolio: ${formatUsd(portfolio.totalValue)} | ${positionsLine}`;
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
	stateSummary: string;
} {
	const {
		account,
		portfolio,
		openPositions,
		exposureSummary,
		performanceMetrics,
		marketIntelligence,
		newsDigest,
		currentTime,
		variant = DEFAULT_VARIANT,
		symbolActionCounts: _symbolActionCounts,
		competition,
	} = params;

	// Get variant-specific prompts
	const variantConfig = getVariantConfig(variant);
	const SYSTEM_PROMPT = variantConfig.systemPrompt;
	const USER_PROMPT = variantConfig.userPrompt;

	const exposureRatio = calculateExposureToEquityPct(
		portfolio,
		exposureSummary,
	);
	const exposurePercentLabel =
		exposureRatio != null && Number.isFinite(exposureRatio)
			? exposureRatio.toFixed(1)
			: "N/A";
	const availableCashLabel = formatUsd(portfolio.availableCash);

	// Calculate risk to equity percentage for prompts that use it
	const riskToEquityPct =
		portfolio.totalValue > 0 && exposureSummary.totalRiskUsd > 0
			? ((exposureSummary.totalRiskUsd / portfolio.totalValue) * 100).toFixed(2)
			: "N/A";

	// Tracked debt: symbol action count context is currently collected but not injected
	// into active prompts. See problems.md issue #16.

	const userPrompt = renderPromptTemplate(USER_PROMPT, {
		"{{INVOKATION_TIMES}}": account.invocationCount.toString(),
		"{{CURRENT_TIME}}": currentTime,
		"{{TOTAL_MINUTES}}": account.totalMinutes.toString(),
		"{{AVAILABLE_CASH}}": availableCashLabel,
		"{{EXPOSURE_TO_EQUITY_PCT}}": exposurePercentLabel,
		"{{RISK_TO_EQUITY_PCT}}": riskToEquityPct,
		"{{MARKET_INTELLIGENCE}}": marketIntelligence,
		"{{PORTFOLIO_SNAPSHOT}}": buildPortfolioSnapshotSection({
			portfolio,
			openPositions,
			exposureSummary,
		}),
		"{{OPEN_POSITIONS_TABLE}}": buildOpenPositionsSection(openPositions),
		"{{PERFORMANCE_OVERVIEW}}": buildPerformanceOverview({
			performanceMetrics,
		}),
		"{{COMPETITION_STANDINGS}}": competition.standings,
		"{{COMPETITION_PNL_DELTA}}": competition.pnlDeltaToLeader,
		"{{COMPETITION_OPEN_POSITIONS}}": competition.openPositionsSummary,
		"{{NEWS}}": newsDigest,
	});

	// Build compact state summary for prepareStep updates
	const stateSummary = buildStateSummary({
		portfolio,
		openPositions,
		exposureSummary,
	});

	return {
		systemPrompt: SYSTEM_PROMPT,
		userPrompt,
		variantId: variant,
		stateSummary,
	};
}
