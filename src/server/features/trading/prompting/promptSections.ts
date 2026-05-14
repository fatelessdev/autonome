import { formatPercentValue } from "@/core/shared/formatting/numberFormat";
import { toFiniteNumber } from "@/core/shared/trading/calculations";
import type { PerformanceMetrics } from "@/server/features/trading/analysis/performanceMetrics";
import type {
	EnrichedOpenPosition,
	ExposureSummary,
} from "@/server/features/trading/data/openPositionEnrichment";
import type { PortfolioSnapshot } from "@/server/features/trading/data/portfolio";

/**
 * Calculate exposure to equity as the percentage of equity that is actually deployed.
 * Uses cash utilization (equity - available cash) instead of raw notional to avoid
 * leverage-inflated percentages.
 */
export function calculateExposureToEquityPct(
	portfolio: PortfolioSnapshot,
	_exposure: ExposureSummary,
): number | null {
	if (!(portfolio.totalValue > 0)) return null;
	const deployedEquity = Math.max(
		portfolio.totalValue - portfolio.availableCash,
		0,
	);
	const pct = (deployedEquity / portfolio.totalValue) * 100;
	return Number.isFinite(pct) ? pct : null;
}

function formatUsd(
	value: number | string | null | undefined,
	digits = 2,
): string {
	const numeric = toFiniteNumber(value);
	if (numeric === null) return "N/A";
	return `$${numeric.toFixed(digits)}`;
}

function formatNullableNumber(
	value: number | string | null | undefined,
	digits = 4,
): string {
	const numeric = toFiniteNumber(value);
	if (numeric === null) return "N/A";
	return numeric.toFixed(digits);
}

function formatConfidence(value: number | null | undefined): string {
	if (value === null || value === undefined || !Number.isFinite(value)) {
		return "N/A";
	}
	const normalized = value <= 1 ? value * 100 : value;
	return `${normalized.toFixed(1)}%`;
}

function sanitizeQuotedPromptField(value: string | null | undefined): string {
	if (!value) return "N/A";
	return value.replaceAll('"', "'");
}

export function buildOpenPositionsSection(
	positions: EnrichedOpenPosition[],
): string {
	if (!positions.length) {
		return "No open positions. Capital fully in cash.";
	}

	const sections = positions.map((position) => {
		// Line 1: Core position info (always include all fields, omit only if N/A)
		const mainParts = [
			`symbol ${position.symbol}`,
			`side ${position.side}`,
			`qty ${formatNullableNumber(position.quantity, 4)}`,
			`entry ${formatNullableNumber(position.entryPrice, 2)}`,
			`mark ${formatNullableNumber(position.markPrice, 2)}`,
			`notional ${formatUsd(position.notionalUsd, 2)}`,
		];
		// Only include liquidation if available (omit N/A)
		if (position.liquidationPrice != null) {
			mainParts.push(
				`liquidation ${formatNullableNumber(position.liquidationPrice, 2)}`,
			);
		}
		const mainLine = mainParts.join(" | ");

		// Line 2: P&L (keep zeros, they're meaningful)
		const pnlParts = [
			`unrealized ${formatUsd(position.unrealizedPnl, 2)}`,
			`scaled_realized ${formatUsd(position.realizedPnl, 2)}`,
		];
		if (position.unrealizedIntradayPl != null) {
			pnlParts.push(
				`intraday_pl ${formatUsd(position.unrealizedIntradayPl, 2)}`,
			);
		}
		if (position.unrealizedIntradayPlpc != null) {
			pnlParts.push(
				`intraday_pl_pct ${formatPercentValue(position.unrealizedIntradayPlpc * 100, { decimals: 2, fallback: "N/A" })}`,
			);
		}
		if (position.changeToday != null) {
			pnlParts.push(
				`change_today ${formatPercentValue(position.changeToday * 100, { decimals: 2, fallback: "N/A" })}`,
			);
		}
		const pnlLine = pnlParts.join(" | ");

		// Line 3: Risk/Reward (explicit labels, omit N/A fields)
		const riskParts: string[] = [];
		if (position.riskUsd !== null) {
			riskParts.push(`risk_usd ${formatUsd(position.riskUsd, 2)}`);
			riskParts.push(
				`risk_pct ${formatPercentValue(position.riskPercent, { decimals: 2, fallback: "N/A" })}`,
			);
		}
		if (position.rewardUsd !== null) {
			riskParts.push(`reward_usd ${formatUsd(position.rewardUsd, 2)}`);
			riskParts.push(
				`reward_pct ${formatPercentValue(position.rewardPercent, { decimals: 2, fallback: "N/A" })}`,
			);
		}
		if (position.riskRewardRatio !== null) {
			riskParts.push(`rr_ratio ${position.riskRewardRatio.toFixed(2)}`);
		}

		// Line 4: Exit plan (quote string fields for clarity)
		const exitPlanLine = `exit_plan: target ${formatNullableNumber(position.exitPlan?.target, 2)} | stop ${formatNullableNumber(position.exitPlan?.stop, 2)} | invalidation "${sanitizeQuotedPromptField(position.exitPlan?.invalidation)}" | time_exit "${sanitizeQuotedPromptField(position.exitPlan?.timeExit)}" | cooldown_until ${position.exitPlan?.cooldownUntil ?? "N/A"}`;

		// Line 5: Intent context (explicit labels)
		const intentLine = `intent: side ${position.side} | confidence ${formatConfidence(position.confidence)} | decision_status ${position.decisionStatus ?? "N/A"} | last_decision_at ${position.lastDecisionAt ?? "N/A"}`;

		// Line 6: Staleness (only for positions with computed staleness)
		const stalenessParts: string[] = [];
		if (position.staleness) {
			stalenessParts.push(`staleness_score ${position.staleness.score}`);
			stalenessParts.push(
				`held_hours ${position.staleness.hoursHeld.toFixed(1)}`,
			);
			stalenessParts.push(
				`time_dim ${position.staleness.timeHeldScore} | pnl_dim ${position.staleness.pnlActionScore} | carry_cost_dim ${position.staleness.fundingCostScore}`,
			);
			if (position.staleness.isStale) {
				stalenessParts.push("⚠ STALE — consider exit");
			}
		}

		const lines = [mainLine, pnlLine];
		if (riskParts.length > 0) {
			lines.push(riskParts.join(" | "));
		}
		lines.push(exitPlanLine, intentLine);
		if (stalenessParts.length > 0) {
			lines.push(stalenessParts.join(" | "));
		}

		return lines.join("\n");
	});

	return sections.join("\n\n");
}

export function buildPortfolioSnapshotSection({
	portfolio,
	openPositions,
	exposureSummary,
}: {
	portfolio: PortfolioSnapshot;
	openPositions: EnrichedOpenPosition[];
	exposureSummary: ExposureSummary;
}): string {
	const exposurePct = calculateExposureToEquityPct(portfolio, exposureSummary);
	const riskPct =
		portfolio.totalValue > 0
			? (exposureSummary.totalRiskUsd / portfolio.totalValue) * 100
			: null;
	const maxRiskPct =
		portfolio.totalValue > 0
			? (exposureSummary.maxPositionRiskUsd / portfolio.totalValue) * 100
			: null;
	const cashUtilizationPct =
		portfolio.totalValue > 0
			? ((portfolio.totalValue - portfolio.availableCash) /
					portfolio.totalValue) *
				100
			: null;

	const netExposure =
		exposureSummary.longExposure - exposureSummary.shortExposure;
	const exposurePctLabel =
		exposurePct !== null && Number.isFinite(exposurePct)
			? exposurePct.toFixed(1)
			: "N/A";
	const cashUtilizationPctLabel =
		cashUtilizationPct !== null && Number.isFinite(cashUtilizationPct)
			? `${cashUtilizationPct.toFixed(1)}%`
			: "N/A";
	const riskPctLabel =
		riskPct !== null && Number.isFinite(riskPct)
			? `${riskPct.toFixed(2)}%`
			: "N/A";
	const maxRiskPctLabel =
		maxRiskPct !== null && Number.isFinite(maxRiskPct)
			? `${maxRiskPct.toFixed(2)}%`
			: "N/A";

	// All fields always shown - zeros are meaningful, AI should never infer
	return [
		`portfolio_value: ${formatUsd(portfolio.totalValue)} | available_cash: ${formatUsd(portfolio.availableCash)} | open_positions: ${openPositions.length}`,
		`cash_utilization_pct: ${cashUtilizationPctLabel} | exposure_to_equity_pct: ${exposurePctLabel === "N/A" ? "N/A" : `${exposurePctLabel}%`}`,
		`gross_exposure_usd: ${formatUsd(exposureSummary.totalNotional)} | long_exposure: ${formatUsd(exposureSummary.longExposure)} | short_exposure: ${formatUsd(exposureSummary.shortExposure)} | net_exposure: ${formatUsd(netExposure)}`,
		`unrealized_pnl: ${formatUsd(exposureSummary.totalUnrealized)} | scaled_realized_pnl: ${formatUsd(exposureSummary.totalRealized)}`,
		`gross_risk_usd: ${formatUsd(exposureSummary.totalRiskUsd)} | risk_to_equity_pct: ${riskPctLabel} | max_single_position_risk_usd: ${formatUsd(exposureSummary.maxPositionRiskUsd)} | max_single_position_risk_pct: ${maxRiskPctLabel}`,
	].join("\n");
}

export function buildPerformanceOverview({
	performanceMetrics,
}: {
	performanceMetrics: PerformanceMetrics;
}): string {
	// PERFORMANCE = historical metrics only (current state is in PORTFOLIO)
	// Prompt-facing metrics: profit factor, R-multiple, decision quality, streaks, duration, time-in-market
	const lines = [
		`closed_trade_realized_pnl: ${formatUsd(performanceMetrics.closedTradeRealizedPnl)} | trade_count: ${performanceMetrics.tradeCount} | win_rate: ${performanceMetrics.winRate}`,
		`total_return_since_start: ${performanceMetrics.totalReturnPercent} | annualized_sharpe_ratio: ${performanceMetrics.welfordSharpeRatio} | trade_signal_to_noise: ${performanceMetrics.tradeSignalToNoise}`,
		`current_drawdown: ${performanceMetrics.currentDrawdown} | max_drawdown: ${performanceMetrics.maxDrawdown} | recovery_factor: ${performanceMetrics.recoveryFactor}`,
		`profit_factor: ${performanceMetrics.profitFactor} | avg_r_multiple: ${performanceMetrics.avgRMultiple} | decision_quality: ${performanceMetrics.decisionQualityScore}`,
		`longest_win_streak: ${performanceMetrics.longestWinStreak} | longest_loss_streak: ${performanceMetrics.longestLossStreak} | current_streak: ${performanceMetrics.currentStreakCount} ${performanceMetrics.currentStreakType}`,
		`avg_win_duration: ${performanceMetrics.avgWinDurationMinutes} | avg_loss_duration: ${performanceMetrics.avgLossDurationMinutes}`,
	];

	// Threshold warnings for prompt-facing metrics
	const warnings: string[] = [];

	// Profit factor < 1.0 means losing money overall
	if (
		performanceMetrics.profitFactor !== "N/A" &&
		performanceMetrics.profitFactor !== "Infinity"
	) {
		const pf = Number(performanceMetrics.profitFactor);
		if (Number.isFinite(pf) && pf < 1.0) {
			warnings.push(
				`⚠ profit_factor ${pf.toFixed(2)} < 1.0 — system is net losing`,
			);
		}
	}

	// R-multiple < 1.0 means average win < average loss
	if (
		performanceMetrics.avgRMultiple !== "N/A" &&
		performanceMetrics.avgRMultiple !== "Infinity"
	) {
		const rm = Number(performanceMetrics.avgRMultiple);
		if (Number.isFinite(rm) && rm < 1.0) {
			warnings.push(
				`⚠ avg_r_multiple ${rm.toFixed(2)} < 1.0 — average win smaller than average loss`,
			);
		}
	}

	// Decision quality negative means confidence is anti-correlated with P&L
	if (performanceMetrics.decisionQualityScore !== "N/A") {
		const dq = Number(performanceMetrics.decisionQualityScore);
		if (Number.isFinite(dq) && dq < 0) {
			warnings.push(
				`⚠ decision_quality ${dq.toFixed(3)} < 0 — confidence is anti-correlated with outcome`,
			);
		}
	}

	// Loss streak > 5 is concerning
	if (performanceMetrics.longestLossStreak > 5) {
		warnings.push(
			`⚠ longest_loss_streak ${performanceMetrics.longestLossStreak} — extended losing streak detected`,
		);
	}

	if (warnings.length > 0) {
		lines.push(warnings.join("\n"));
	}

	return lines.join("\n");
}

export { formatUsd };
