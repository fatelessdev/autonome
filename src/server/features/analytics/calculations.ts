/**
 * Analytics Calculations - Pure functions for computing trading statistics
 * Uses shared calculation utilities from @/core/shared/trading/calculations
 */

import {
	calculateExpectancy,
	calculateHoldTimeMinutes,
	calculateRecoveryFactorFromPnls,
	calculateReturnPercent,
	calculateSharpeRatioFromTrades,
	calculateTotalPnl,
	calculateTradeSize,
	calculateWinRate,
	mean,
	median,
} from "@/core/shared/trading/calculations";

import type {
	AdvancedStats,
	ClosedTradeData,
	ModelAnalytics,
	OverallStats,
} from "./types";

// Re-export INITIAL_CAPITAL for backward compatibility
export { INITIAL_CAPITAL } from "@/core/shared/trading/calculations";

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
			sharpeRatio: 0,
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

	// Use trade-based Sharpe ratio calculation
	const sharpeRatio = calculateSharpeRatioFromTrades(pnls);

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
		sharpeRatio,
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
		invocationCount: number;
	},
	variant?: string,
): AdvancedStats {
	const defaultFailureMetrics = {
		failedWorkflowCount: failureMetrics?.failedWorkflowCount ?? 0,
		failedToolCallCount: failureMetrics?.failedToolCallCount ?? 0,
		invocationCount: failureMetrics?.invocationCount ?? 0,
	};
	const failureRate =
		defaultFailureMetrics.invocationCount > 0
			? ((defaultFailureMetrics.failedWorkflowCount +
					defaultFailureMetrics.failedToolCallCount) /
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
