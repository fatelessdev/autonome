/**
 * Analytics Calculations - Pure functions for computing trading statistics
 * Uses shared calculation utilities from @/core/shared/trading/calculations
 */

import {
	calculateExpectancy,
	calculateHoldTimeMinutes,
	calculateRecoveryFactorFromPnls,
	calculateReturnPercent,
	calculateTotalPnl,
	calculateTradeSize,
	calculateWinRate,
	mean,
	median,
	tradeSignalToNoiseRatio,
} from "@/core/shared/trading/calculations";
import { computePearsonCorrelation } from "@/server/features/trading/analysis/correlationMatrix";

import type {
	AdvancedStats,
	ClosedTradeData,
	ModelAnalytics,
	OverallStats,
} from "./types";

// Re-export INITIAL_CAPITAL for backward compatibility
export { INITIAL_CAPITAL } from "@/core/shared/trading/calculations";

// ==================== New Analytics Metrics ====================

/**
 * Profit Factor = sum(wins) / abs(sum(losses)).
 * Answers: "How much does this variant make per dollar lost?"
 *
 * Returns:
 *   - "Infinity" when no losses (all wins)
 *   - "0.00" when no wins (all losses)
 *   - "N/A" when no trades
 */
export function calculateProfitFactor(pnls: number[]): number | "N/A" {
	if (pnls.length === 0) return "N/A";

	const wins = pnls.filter((p) => p > 0);
	const losses = pnls.filter((p) => p < 0);

	const totalWins = wins.reduce((sum, p) => sum + p, 0);
	const totalLosses = Math.abs(losses.reduce((sum, p) => sum + p, 0));

	if (totalLosses === 0) return totalWins > 0 ? Number.POSITIVE_INFINITY : 0;
	if (totalWins === 0) return 0;

	return totalWins / totalLosses;
}

/**
 * Average R-Multiple = mean(wins) / abs(mean(losses)).
 * Answers: "Is this variant's average win bigger than its average loss?"
 *
 * Returns:
 *   - "Infinity" when no losses (all wins)
 *   - "0.00" when no wins (all losses)
 *   - "N/A" when no trades
 */
export function calculateRMultiple(pnls: number[]): number | "N/A" {
	if (pnls.length === 0) return "N/A";

	const wins = pnls.filter((p) => p > 0);
	const losses = pnls.filter((p) => p < 0);

	const avgWin = wins.length > 0 ? mean(wins) : 0;
	const avgLoss = losses.length > 0 ? Math.abs(mean(losses)) : 0;

	if (avgLoss === 0) return avgWin > 0 ? Number.POSITIVE_INFINITY : 0;
	if (avgWin === 0) return 0;

	return avgWin / avgLoss;
}

/**
 * Decision Quality Score = Pearson correlation between confidence and realized P&L.
 * Answers: "Is this variant's confidence calibrated? Do high-confidence trades perform better?"
 *
 * Returns:
 *   - "N/A" when fewer than 3 confidence-tagged trades
 *   - number in [-1, 1] otherwise
 */
export function calculateDecisionQualityScore(
	trades: ClosedTradeData[],
): number | "N/A" {
	const tagged = trades.filter(
		(t) => t.confidence !== null && Number.isFinite(t.confidence),
	);

	if (tagged.length < 3) return "N/A";

	const confidences = tagged.map((t) => t.confidence as number);
	const pnls = tagged.map((t) => t.realizedPnl);

	const result = computePearsonCorrelation(confidences, pnls);
	return result ?? "N/A";
}

/**
 * Sortino Ratio = annualized return / downside deviation.
 * Better than Sharpe for asymmetric returns (trading systems).
 * Only counts negative returns when computing deviation.
 *
 * @param returns Array of portfolio period returns (not P&Ls, but % returns)
 * @param annualizationFactor Number of periods per year (default: 5-min cycles = 105120)
 */
export function calculateSortinoRatio(
	returns: number[],
	annualizationFactor: number = 365 * 24 * 12,
): number | "N/A" {
	if (returns.length < 2) return "N/A";

	const meanReturn = mean(returns);
	const negativeReturns = returns.filter((r) => r < 0);

	if (negativeReturns.length === 0) {
		// No negative returns: infinite Sortino if mean > 0
		return meanReturn > 0 ? Number.POSITIVE_INFINITY : 0;
	}

	const sumSquaredDownside = negativeReturns.reduce((sum, r) => sum + r * r, 0);
	const downsideDeviation = Math.sqrt(
		sumSquaredDownside / negativeReturns.length,
	);

	if (downsideDeviation < 1e-10)
		return meanReturn > 0 ? Number.POSITIVE_INFINITY : 0;

	const annualizedReturn = meanReturn * annualizationFactor;
	const annualizedDownside = downsideDeviation * Math.sqrt(annualizationFactor);

	const ratio = annualizedReturn / annualizedDownside;
	return Number.isFinite(ratio) && Math.abs(ratio) <= 100 ? ratio : "N/A";
}

/**
 * Calmar Ratio = total return % / max drawdown %.
 * Answers: "Which variant gets the most return per unit of drawdown risk?"
 *
 * @param totalReturnPct Total return as percentage (e.g. 20 for 20%)
 * @param maxDrawdownPct Max drawdown as positive percentage (e.g. 10 for 10%)
 */
export function calculateCalmarRatio(
	totalReturnPct: number,
	maxDrawdownPct: number,
): number | "N/A" {
	if (!(maxDrawdownPct > 0)) return "N/A";

	const ratio = totalReturnPct / maxDrawdownPct;
	return Number.isFinite(ratio) ? ratio : "N/A";
}

export interface StreakResult {
	longestWinStreak: number;
	longestLossStreak: number;
	currentStreakCount: number;
	currentStreakType: "win" | "loss" | "none";
}

/**
 * Compute consecutive win/loss streaks from closed trades sorted by closedAt.
 * Returns longest and current streaks.
 */
export function calculateStreaks(trades: ClosedTradeData[]): StreakResult {
	if (trades.length === 0) {
		return {
			longestWinStreak: 0,
			longestLossStreak: 0,
			currentStreakCount: 0,
			currentStreakType: "none",
		};
	}

	// Sort by closedAt ascending
	const sorted = [...trades].sort(
		(a, b) => a.closedAt.getTime() - b.closedAt.getTime(),
	);

	let longestWinStreak = 0;
	let longestLossStreak = 0;
	let currentRun = 0;
	let currentIsWin = false;

	for (let i = 0; i < sorted.length; i++) {
		const isWin = sorted[i].realizedPnl > 0;
		if (i === 0) {
			currentRun = 1;
			currentIsWin = isWin;
		} else if (isWin === currentIsWin) {
			currentRun++;
		} else {
			// Streak broken — record it
			if (currentIsWin) {
				longestWinStreak = Math.max(longestWinStreak, currentRun);
			} else {
				longestLossStreak = Math.max(longestLossStreak, currentRun);
			}
			currentRun = 1;
			currentIsWin = isWin;
		}
	}

	// Record final streak
	if (currentIsWin) {
		longestWinStreak = Math.max(longestWinStreak, currentRun);
	} else {
		longestLossStreak = Math.max(longestLossStreak, currentRun);
	}

	return {
		longestWinStreak,
		longestLossStreak,
		currentStreakCount: currentRun,
		currentStreakType: currentIsWin ? "win" : "loss",
	};
}

export interface DurationDistribution {
	avgWinDurationMinutes: number;
	avgLossDurationMinutes: number;
}

/**
 * Compute average hold time for winners vs losers.
 * Answers: "Does this variant cut winners short and let losers run?"
 */
export function calculateDurationDistribution(
	trades: ClosedTradeData[],
): DurationDistribution {
	const wins = trades.filter((t) => t.realizedPnl > 0);
	const losses = trades.filter((t) => t.realizedPnl < 0);

	const avgWinDurationMinutes =
		wins.length > 0
			? mean(wins.map((t) => calculateHoldTimeMinutes(t.openedAt, t.closedAt)))
			: 0;
	const avgLossDurationMinutes =
		losses.length > 0
			? mean(
					losses.map((t) => calculateHoldTimeMinutes(t.openedAt, t.closedAt)),
				)
			: 0;

	return { avgWinDurationMinutes, avgLossDurationMinutes };
}

/**
 * Calculate overall stats for a model's closed trades
 */
export function calculateOverallStats(
	modelId: string,
	modelName: string,
	trades: ClosedTradeData[],
	currentAccountValue: number,
	variant?: string,
): OverallStats {
	const tradesCount = trades.length;

	if (tradesCount === 0) {
		return {
			modelId,
			modelName,
			variant,
			accountValue: currentAccountValue,
			returnPercent: calculateReturnPercent(currentAccountValue),
			totalPnl: 0,
			winRate: 0,
			biggestWin: 0,
			biggestLoss: 0,
			tradeSignalToNoise: 0,
			tradesCount: 0,
		};
	}

	const pnls = trades.map((t) => t.realizedPnl);
	const totalPnl = calculateTotalPnl(pnls);
	const wins = pnls.filter((p) => p > 0);
	const losses = pnls.filter((p) => p < 0);

	const winRate = calculateWinRate(pnls);
	const biggestWin = wins.length > 0 ? Math.max(...wins) : 0;
	const biggestLoss = losses.length > 0 ? Math.min(...losses) : 0;

	// Use trade signal-to-noise ratio (non-annualized, from closed trade P&Ls)
	const tradeSignalToNoise = tradeSignalToNoiseRatio(pnls);

	const returnPercent = calculateReturnPercent(currentAccountValue);

	return {
		modelId,
		modelName,
		variant,
		accountValue: currentAccountValue,
		returnPercent,
		totalPnl,
		winRate,
		biggestWin,
		biggestLoss,
		tradeSignalToNoise,
		tradesCount,
	};
}

/**
 * Calculate advanced stats for a model's closed trades
 */
export function calculateAdvancedStats(
	modelId: string,
	modelName: string,
	trades: ClosedTradeData[],
	currentAccountValue: number,
	failureMetrics?: {
		failedWorkflowCount: number;
		failedToolCallCount: number;
		failedCount?: number;
		invocationCount: number;
	},
	variant?: string,
): AdvancedStats {
	const defaultFailureMetrics = {
		failedWorkflowCount: failureMetrics?.failedWorkflowCount ?? 0,
		failedToolCallCount: failureMetrics?.failedToolCallCount ?? 0,
		failedCount:
			failureMetrics?.failedCount ??
			Math.min(
				(failureMetrics?.failedWorkflowCount ?? 0) +
					(failureMetrics?.failedToolCallCount ?? 0),
				failureMetrics?.invocationCount ?? 0,
			),
		invocationCount: failureMetrics?.invocationCount ?? 0,
	};
	const failureRate =
		defaultFailureMetrics.invocationCount > 0
			? (defaultFailureMetrics.failedCount /
					defaultFailureMetrics.invocationCount) *
				100
			: 0;

	if (trades.length === 0) {
		return {
			modelId,
			modelName,
			variant,
			accountValue: currentAccountValue,
			avgTradeSize: 0,
			medianTradeSize: 0,
			maxTradeSize: 0,
			avgHoldTimeMinutes: 0,
			medianHoldTimeMinutes: 0,
			maxHoldTimeMinutes: 0,
			longPercent: 0,
			expectancy: 0,
			recoveryFactor: 0,
			avgConfidence: 0,
			medianConfidence: 0,
			maxConfidence: 0,
			...defaultFailureMetrics,
			failureRate,
			profitFactor: "N/A",
			avgRMultiple: "N/A",
			decisionQualityScore: "N/A",
			sortinoRatio: "N/A",
			calmarRatio: "N/A",
			longestWinStreak: 0,
			longestLossStreak: 0,
			currentStreakCount: 0,
			currentStreakType: "none",
			avgWinDurationMinutes: 0,
			avgLossDurationMinutes: 0,
		};
	}

	// Trade sizes
	const tradeSizes = trades
		.map((t) => calculateTradeSize(t.quantity, t.entryPrice))
		.sort((a, b) => a - b);
	const avgTradeSize = mean(tradeSizes);
	const medianTradeSize = median(tradeSizes);
	const maxTradeSize = tradeSizes.at(-1);
	if (maxTradeSize == null) {
		throw new Error(`Failed to compute maxTradeSize for model ${modelId}`);
	}

	// Hold times
	const holdTimes = trades
		.map((t) => calculateHoldTimeMinutes(t.openedAt, t.closedAt))
		.sort((a, b) => a - b);
	const avgHoldTimeMinutes = mean(holdTimes);
	const medianHoldTimeMinutes = median(holdTimes);
	const maxHoldTimeMinutes = holdTimes.at(-1);
	if (maxHoldTimeMinutes == null) {
		throw new Error(
			`Failed to compute maxHoldTimeMinutes for model ${modelId}`,
		);
	}

	// Long percentage
	const longTrades = trades.filter((t) => t.side === "LONG").length;
	const longPercent = (longTrades / trades.length) * 100;

	// Expectancy using shared calculation
	const pnls = trades.map((t) => t.realizedPnl);
	const expectancy = calculateExpectancy(pnls);
	const recoveryFactor = calculateRecoveryFactorFromPnls(pnls);

	// Confidence stats (filter nulls)
	const confidences = trades
		.map((t) => t.confidence)
		.filter((c): c is number => c !== null && Number.isFinite(c))
		.sort((a, b) => a - b);
	const avgConfidence = confidences.length > 0 ? mean(confidences) : 0;
	const medianConfidence = median(confidences);
	const maxConfidence =
		confidences.length > 0
			? (() => {
					const value = confidences.at(-1);
					if (value == null) {
						throw new Error(
							`Failed to compute maxConfidence for model ${modelId}`,
						);
					}
					return value;
				})()
			: 0;

	// New analytics metrics
	const profitFactor = calculateProfitFactor(pnls);
	const avgRMultiple = calculateRMultiple(pnls);
	const decisionQualityScore = calculateDecisionQualityScore(trades);
	const streaks = calculateStreaks(trades);
	const durationDist = calculateDurationDistribution(trades);

	// Sortino ratio requires portfolio returns (not P&Ls) — compute from closedAt-sorted cumulative equity
	const sortedByTime = [...trades].sort(
		(a, b) => a.closedAt.getTime() - b.closedAt.getTime(),
	);
	const cumulativeReturns: number[] = [];
	let runningEquity = currentAccountValue - pnls.reduce((s, p) => s + p, 0);
	for (const trade of sortedByTime) {
		runningEquity += trade.realizedPnl;
		const periodReturn =
			trade.realizedPnl / (runningEquity - trade.realizedPnl);
		if (Number.isFinite(periodReturn)) {
			cumulativeReturns.push(periodReturn);
		}
	}
	const sortinoRatio = calculateSortinoRatio(cumulativeReturns, 365);

	// Calmar ratio: total return % / max drawdown %
	const totalReturnPct = calculateReturnPercent(currentAccountValue);
	const maxDrawdownPct = (() => {
		let peak = Number.NEGATIVE_INFINITY;
		let maxDd = 0;
		let equity = currentAccountValue - pnls.reduce((s, p) => s + p, 0);
		for (const trade of sortedByTime) {
			equity += trade.realizedPnl;
			if (equity > peak) peak = equity;
			const dd = peak > 0 ? ((peak - equity) / peak) * 100 : 0;
			if (dd > maxDd) maxDd = dd;
		}
		return maxDd;
	})();
	const calmarRatio = calculateCalmarRatio(totalReturnPct, maxDrawdownPct);

	return {
		modelId,
		modelName,
		variant,
		accountValue: currentAccountValue,
		avgTradeSize,
		medianTradeSize,
		maxTradeSize,
		avgHoldTimeMinutes,
		medianHoldTimeMinutes,
		maxHoldTimeMinutes,
		longPercent,
		expectancy,
		recoveryFactor,
		avgConfidence,
		medianConfidence,
		maxConfidence,
		...defaultFailureMetrics,
		failureRate,
		profitFactor,
		avgRMultiple,
		decisionQualityScore,
		sortinoRatio,
		calmarRatio,
		...streaks,
		avgWinDurationMinutes: durationDist.avgWinDurationMinutes,
		avgLossDurationMinutes: durationDist.avgLossDurationMinutes,
	};
}

/**
 * Calculate all analytics for a model
 */
export function calculateModelAnalytics(
	modelId: string,
	modelName: string,
	trades: ClosedTradeData[],
	currentAccountValue: number,
	failureMetrics?: {
		failedWorkflowCount: number;
		failedToolCallCount: number;
		failedCount?: number;
		invocationCount: number;
	},
): ModelAnalytics {
	return {
		overall: calculateOverallStats(
			modelId,
			modelName,
			trades,
			currentAccountValue,
		),
		advanced: calculateAdvancedStats(
			modelId,
			modelName,
			trades,
			currentAccountValue,
			failureMetrics,
		),
	};
}
