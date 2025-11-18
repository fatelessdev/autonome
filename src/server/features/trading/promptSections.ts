import type { Account } from "@/server/features/trading/accounts";
import type { PortfolioSnapshot } from "@/server/features/trading/getPortfolio";
import type {
	EnrichedOpenPosition,
	ExposureSummary,
} from "@/server/features/trading/openPositionEnrichment";
import { toNumeric } from "@/server/features/trading/openPositionEnrichment";
import type { PerformanceMetrics } from "@/server/features/trading/performanceMetrics";

function formatUsd(
	value: number | string | null | undefined,
	digits = 2,
): string {
	const numeric = toNumeric(value);
	if (numeric === null) return "N/A";
	return `$${numeric.toFixed(digits)}`;
}

function formatNullableNumber(
	value: number | string | null | undefined,
	digits = 4,
): string {
	const numeric = toNumeric(value);
	if (numeric === null) return "N/A";
	return numeric.toFixed(digits);
}

function formatPercent(
	value: number | string | null | undefined,
	digits = 2,
): string {
	const numeric = toNumeric(value);
	if (numeric === null) return "N/A";
	return `${numeric.toFixed(digits)}%`;
}

function formatConfidence(value: number | null | undefined): string {
	if (value === null || value === undefined || !Number.isFinite(value)) {
		return "N/A";
	}
	const normalized = value <= 1 ? value * 100 : value;
	return `${normalized.toFixed(1)}%`;
}

function formatIsoDate(value: string | null | undefined): string {
	if (!value) return "N/A";
	return value;
}

export function buildOpenPositionsSection(
	positions: EnrichedOpenPosition[],
): string {
	if (!positions.length) {
		return "No open positions. Capital fully in cash.";
	}

	const sections = positions.map((position) => {
		const leverage =
			position.leverage != null ? `${position.leverage.toFixed(2)}x` : "n/a";
		const mainLine = [
			`symbol ${position.symbol}`,
			`side ${position.sign}`,
			`qty ${formatNullableNumber(position.quantity, 4)}`,
			`notional ${formatUsd(position.notionalUsd, 2)}`,
			`entry ${formatNullableNumber(position.entryPrice, 2)}`,
			`mark ${formatNullableNumber(position.markPrice, 2)}`,
			`liquidation ${formatNullableNumber(position.liquidationPrice, 2)}`,
			`unrealized ${formatUsd(position.unrealizedPnl, 2)}`,
			`realized ${formatUsd(position.realizedPnl, 2)}`,
			`leverage ${leverage}`,
		].join(" | ");

		const riskPieces = [
			`risk_usd ${formatUsd(position.riskUsd, 2)}`,
			`risk_pct ${formatPercent(position.riskPercent, 2)}`,
		];

		if (position.rewardUsd !== null) {
			riskPieces.push(`reward_usd ${formatUsd(position.rewardUsd, 2)}`);
		}
		if (position.rewardPercent !== null) {
			riskPieces.push(`reward_pct ${formatPercent(position.rewardPercent, 2)}`);
		}
		if (position.riskRewardRatio !== null) {
			riskPieces.push(`rr_ratio ${position.riskRewardRatio.toFixed(2)}`);
		}

		const exitPlanLine = `exit_plan: target ${formatNullableNumber(position.exitPlan?.target, 2)} | stop ${formatNullableNumber(position.exitPlan?.stop, 2)} | invalidation ${position.exitPlan?.invalidation ?? "N/A"}`;

		const intentLine = `intent: signal ${position.signal ?? position.sign} | confidence ${formatConfidence(position.confidence)} | decision_status ${position.decisionStatus ?? "N/A"} | last_decision_at ${formatIsoDate(position.lastDecisionAt)}`;

		return [mainLine, riskPieces.join(" | "), exitPlanLine, intentLine].join(
			"\n",
		);
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
	const cashUtilization =
		portfolio.totalValue > 0
			? 1 - portfolio.availableCash / portfolio.totalValue
			: null;
	const exposurePct =
		portfolio.totalValue > 0 && exposureSummary.totalNotional > 0
			? (exposureSummary.totalNotional / portfolio.totalValue) * 100
			: null;

	const lines = [
		`portfolio_value: ${formatUsd(portfolio.totalValue)}`,
		`available_cash: ${formatUsd(portfolio.availableCash)}`,
		`open_positions: ${openPositions.length}`,
		`gross_exposure_usd: ${formatUsd(exposureSummary.totalNotional)}`,
		`unrealized_pnl: ${formatUsd(exposureSummary.totalUnrealized)}`,
		`realized_pnl: ${formatUsd(exposureSummary.totalRealized)}`,
	];

	if (cashUtilization !== null && Number.isFinite(cashUtilization)) {
		lines.push(`cash_utilization_pct: ${(cashUtilization * 100).toFixed(1)}%`);
	}

	if (exposurePct !== null && Number.isFinite(exposurePct)) {
		lines.push(`exposure_to_equity_pct: ${exposurePct.toFixed(1)}%`);
	}

	if (portfolio.totalValue > 0 && exposureSummary.totalRiskUsd > 0) {
		lines.push(
			`risk_to_equity_pct: ${((exposureSummary.totalRiskUsd / portfolio.totalValue) * 100).toFixed(2)}%`,
		);
	}

	return lines.join("\n");
}

export function buildPerformanceOverview({
	account,
	portfolio,
	performanceMetrics,
	openPositions,
	exposureSummary,
}: {
	account: Account;
	portfolio: PortfolioSnapshot;
	performanceMetrics: PerformanceMetrics;
	openPositions: EnrichedOpenPosition[];
	exposureSummary: ExposureSummary;
}): string {
	const exposure = exposureSummary;
	const netExposure = exposure.longExposure - exposure.shortExposure;
	const exposureRatio =
		portfolio.totalValue > 0
			? (exposure.totalNotional / portfolio.totalValue) * 100
			: null;
	const grossRiskRatio =
		portfolio.totalValue > 0 && exposure.totalRiskUsd > 0
			? (exposure.totalRiskUsd / portfolio.totalValue) * 100
			: null;
	const maxRiskRatio =
		portfolio.totalValue > 0 && exposure.maxPositionRiskUsd > 0
			? (exposure.maxPositionRiskUsd / portfolio.totalValue) * 100
			: null;

	const lines = [
		`scheduled_interval_minutes: 5`,
		`invocations_completed: ${account.invocationCount}`,
		`elapsed_minutes: ${account.totalMinutes}`,
		`portfolio_value: ${formatUsd(portfolio.totalValue)}`,
		`available_cash: ${formatUsd(portfolio.availableCash)}`,
		`open_positions: ${openPositions.length}`,
		`total_notional_exposure: ${formatUsd(exposure.totalNotional)}`,
		`long_exposure: ${formatUsd(exposure.longExposure)}`,
		`short_exposure: ${formatUsd(exposure.shortExposure)}`,
		`net_exposure: ${formatUsd(netExposure)}`,
		`unrealized_pnl: ${formatUsd(exposure.totalUnrealized)}`,
		`realized_pnl: ${formatUsd(exposure.totalRealized)}`,
		`gross_risk_usd: ${formatUsd(exposure.totalRiskUsd)}`,
		`max_single_position_risk_usd: ${formatUsd(exposure.maxPositionRiskUsd)}`,
		`annualized_sharpe_ratio: ${performanceMetrics.sharpeRatio}`,
		`total_return_since_start: ${performanceMetrics.totalReturnPercent}`,
	];

	if (exposureRatio !== null && Number.isFinite(exposureRatio)) {
		lines.splice(6, 0, `exposure_to_equity_pct: ${exposureRatio.toFixed(2)}%`);
	}

	if (grossRiskRatio !== null && Number.isFinite(grossRiskRatio)) {
		lines.push(`risk_to_equity_pct: ${grossRiskRatio.toFixed(2)}%`);
	}

	if (maxRiskRatio !== null && Number.isFinite(maxRiskRatio)) {
		lines.push(`max_position_risk_pct: ${maxRiskRatio.toFixed(2)}%`);
	}

	return lines.join("\n");
}

export { formatUsd };
