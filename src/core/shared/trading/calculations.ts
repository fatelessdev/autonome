/**
 * Centralized Trading Calculations
 *
 * This module provides shared calculation functions for P&L, Sharpe ratio,
 * and other trading metrics used across the application.
 */

import { normalizeNumber } from "@/core/shared/formatting/numberFormat";

// ==================== Constants ====================

export const INITIAL_CAPITAL = 100_000;
export const RISK_FREE_RATE = 0;

// ==================== Numeric Validation Utilities ====================

/**
 * Parse an unknown value to a finite number, or return null.
 * Use for optional fields where null is a valid outcome.
 */
export function toFiniteNumber(value: unknown): number | null {
	if (typeof value === "number") {
		return Number.isFinite(value) ? value : null;
	}
	if (typeof value === "string" && value.trim().length > 0) {
		const parsed = Number.parseFloat(value);
		return Number.isFinite(parsed) ? parsed : null;
	}
	return null;
}

/**
 * Require a finite number, throwing with context on failure.
 * Use for required fields where null/NaN indicates a data integrity bug.
 */
export function requireFiniteNumber(value: unknown, context: string): number {
	const parsed = toFiniteNumber(value);
	if (parsed === null) {
		throw new Error(`Invalid numeric value for ${context}: ${String(value)}`);
	}
	return parsed;
}

/**
 * Require a non-null/undefined value, throwing with context on failure.
 */
export function requirePresent<T>(
	value: T | null | undefined,
	context: string,
): T {
	if (value == null) {
		throw new Error(`Missing required value for ${context}`);
	}
	return value;
}

// ==================== P&L Calculations ====================

export interface PositionForPnL {
	quantity?: number | null;
	notional?: string | number | null;
	sign?: "LONG" | "SHORT" | string | null;
	unrealizedPnl?: number | string | null;
}

/**
 * Calculate unrealized P&L for a position using current market price.
 * Falls back to stored unrealizedPnl if market price is unavailable.
 */
export function calculateUnrealizedPnl(
	position: PositionForPnL,
	currentPrice: number | null,
): number {
	if (currentPrice == null || !Number.isFinite(currentPrice)) {
		return normalizeNumber(position.unrealizedPnl) ?? 0;
	}

	const quantity = position.quantity ?? 0;
	const notional = normalizeNumber(position.notional) ?? 0;

	if (quantity === 0 || notional === 0) {
		return normalizeNumber(position.unrealizedPnl) ?? 0;
	}

	// Derive entry price from notional / quantity
	const entryPrice = notional / quantity;
	const isLong = position.sign === "LONG";

	return isLong
		? (currentPrice - entryPrice) * quantity
		: (entryPrice - currentPrice) * quantity;
}

/**
 * Calculate total P&L from an array of individual P&L values.
 */
export function calculateTotalPnl(pnls: number[]): number {
	return pnls.reduce((sum, pnl) => sum + pnl, 0);
}

/**
 * Calculate win rate from P&L values.
 * Returns percentage (0-100).
 */
export function calculateWinRate(pnls: number[]): number {
	if (pnls.length === 0) return 0;
	const wins = pnls.filter((p) => p > 0).length;
	return (wins / pnls.length) * 100;
}

/**
 * Compute max drawdown from a series of portfolio values.
 * Returns as a positive percentage (e.g., 32.5 = 32.5% drawdown).
 */
export function calculateMaxDrawdown(values: number[]): number {
	if (values.length < 1) return 0;
	let peak = Number.NEGATIVE_INFINITY;
	let maxDd = 0;
	for (const v of values) {
		if (!Number.isFinite(v)) continue;
		if (v > peak) peak = v;
		const dd = peak > 0 ? ((peak - v) / peak) * 100 : 0;
		if (dd > maxDd) maxDd = dd;
	}
	return maxDd;
}

/**
 * Compute maximum absolute drawdown from a series of equity values.
 * Returns currency units (for example, dollars), not percentage.
 */
export function calculateMaxDrawdownAbsolute(values: number[]): number {
	if (values.length < 1) return 0;
	let peak = Number.NEGATIVE_INFINITY;
	let maxDdAbs = 0;
	for (const v of values) {
		if (!Number.isFinite(v)) continue;
		if (v > peak) peak = v;
		const ddAbs = peak - v;
		if (ddAbs > maxDdAbs) maxDdAbs = ddAbs;
	}
	return maxDdAbs;
}

/**
 * Compute current drawdown from peak to current value.
 * Returns as a positive percentage (e.g., 15.2 = 15.2% below peak).
 */
export function calculateCurrentDrawdown(values: number[]): number {
	if (values.length < 1) return 0;
	const peak = Math.max(...values);
	const current = values[values.length - 1];
	if (peak <= 0) return 0;
	return ((peak - current) / peak) * 100;
}

// ==================== Statistical Helpers ====================

/**
 * Calculate mean of an array of numbers.
 */
export function mean(values: number[]): number {
	if (values.length === 0) return 0;
	return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Calculate standard deviation (population).
 */
export function standardDeviation(
	values: number[],
	meanValue?: number,
): number {
	if (values.length < 2) return 0;
	const avg = meanValue ?? mean(values);
	const squaredDiffs = values.map((v) => (v - avg) ** 2);
	const variance = squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
	return Math.sqrt(variance);
}

/**
 * Calculate median of an array of numbers.
 * Note: Expects a sorted array for efficiency.
 */
export function median(sortedValues: number[]): number {
	if (sortedValues.length === 0) return 0;
	const mid = Math.floor(sortedValues.length / 2);
	return sortedValues.length % 2 !== 0
		? sortedValues[mid]
		: (sortedValues[mid - 1] + sortedValues[mid]) / 2;
}

// ==================== Sharpe Ratio ====================

export interface SharpeRatioResult {
	sharpeRatio: number;
	sharpeRatioFormatted: string;
	isValid: boolean;
	reason?: string;
}

/**
 * Calculate Sharpe ratio from portfolio history (NAV-based).
 * This is the preferred method for accurate risk-adjusted returns.
 *
 * @param portfolioValues Array of portfolio values over time (chronological order)
 * @param periodMinutes Minutes between each observation (default: 1 for 1-minute snapshots)
 * @returns Sharpe ratio calculation result
 */
export function calculateSharpeRatioFromPortfolio(
	portfolioValues: number[],
	periodMinutes: number = 1,
): SharpeRatioResult {
	if (portfolioValues.length < 2) {
		return {
			sharpeRatio: 0,
			sharpeRatioFormatted: "N/A (need more data)",
			isValid: false,
			reason: "Insufficient data points",
		};
	}

	// Calculate period returns
	const returns: number[] = [];
	for (let i = 1; i < portfolioValues.length; i++) {
		const prevValue = portfolioValues[i - 1];
		const currValue = portfolioValues[i];
		if (prevValue > 0) {
			returns.push((currValue - prevValue) / prevValue);
		}
	}

	if (returns.length < 2) {
		return {
			sharpeRatio: 0,
			sharpeRatioFormatted: "N/A (need more data)",
			isValid: false,
			reason: "Insufficient return data",
		};
	}

	// Require minimum 30 data points for statistical significance
	if (returns.length < 30) {
		return {
			sharpeRatio: 0,
			sharpeRatioFormatted: "N/A (insufficient data)",
			isValid: false,
			reason: "Need at least 30 observations",
		};
	}

	const meanReturn = mean(returns);
	const stdDev = standardDeviation(returns, meanReturn);

	if (stdDev === 0 || stdDev < 0.0001) {
		return {
			sharpeRatio: 0,
			sharpeRatioFormatted: "N/A (low volatility)",
			isValid: false,
			reason: "Volatility too low for meaningful Sharpe",
		};
	}

	// Annualize based on the observation period
	const periodsPerYear = (365 * 24 * 60) / periodMinutes;
	const annualizedReturn = (1 + meanReturn) ** periodsPerYear - 1;
	const annualizedStdDev = stdDev * Math.sqrt(periodsPerYear);

	const sharpeRatio = (annualizedReturn - RISK_FREE_RATE) / annualizedStdDev;

	return {
		sharpeRatio,
		sharpeRatioFormatted: sharpeRatio.toFixed(3),
		isValid: true,
	};
}

/**
 * Calculate Sharpe ratio from trade P&Ls (simplified trade-based method).
 * Less accurate than portfolio-based but useful when only trade data is available.
 *
 * @param pnls Array of realized P&L values from closed trades
 * @returns Sharpe ratio (non-annualized, raw signal-to-noise)
 */
export function calculateSharpeRatioFromTrades(pnls: number[]): number {
	if (pnls.length < 2) return 0;

	const meanPnl = mean(pnls);
	const stdDev = standardDeviation(pnls, meanPnl);

	if (stdDev === 0) return 0;

	// Simple Sharpe: (mean - risk-free) / stdDev
	// Risk-free rate is 0, so just mean / stdDev
	return (meanPnl - RISK_FREE_RATE) / stdDev;
}

// ==================== Return Calculations ====================

/**
 * Calculate total return percentage from initial and current values.
 */
export function calculateReturnPercent(
	currentValue: number,
	initialValue: number = INITIAL_CAPITAL,
): number {
	if (initialValue === 0) return 0;
	return ((currentValue - initialValue) / initialValue) * 100;
}

// ==================== Hold Time Calculations ====================

/**
 * Calculate hold time in minutes between two timestamps.
 */
export function calculateHoldTimeMinutes(
	openedAt: Date,
	closedAt: Date,
): number {
	const diffMs = closedAt.getTime() - openedAt.getTime();
	return Math.max(0, diffMs / (1000 * 60));
}

/**
 * Format hold time in human-readable format.
 */
export function formatHoldTime(minutes: number): string {
	if (minutes < 60) return `${Math.round(minutes)}m`;
	if (minutes < 1440) return `${(minutes / 60).toFixed(1)}h`;
	return `${(minutes / 1440).toFixed(1)}d`;
}

// ==================== Trade Size Calculations ====================

/**
 * Calculate trade size (notional value at entry).
 */
export function calculateTradeSize(
	quantity: number,
	entryPrice: number,
): number {
	return Math.abs(quantity * entryPrice);
}

// ==================== Expectancy ====================

/**
 * Calculate expectancy from trade P&Ls.
 * Expectancy = (Win% * Avg Win) - (Loss% * Avg Loss)
 */
export function calculateExpectancy(pnls: number[]): number {
	if (pnls.length === 0) return 0;

	const wins = pnls.filter((p) => p > 0);
	const losses = pnls.filter((p) => p < 0);

	const avgWin = wins.length > 0 ? mean(wins) : 0;
	const avgLoss = losses.length > 0 ? Math.abs(mean(losses)) : 0;

	const winPct = wins.length / pnls.length;
	const lossPct = losses.length / pnls.length;

	return winPct * avgWin - lossPct * avgLoss;
}

/**
 * Recovery factor = net profit / max absolute drawdown.
 * Returns 0 when drawdown is zero or invalid.
 */
export function calculateRecoveryFactor(values: number[]): number {
	if (values.length < 2) return 0;
	const start = values[0];
	const end = values[values.length - 1];
	if (!Number.isFinite(start) || !Number.isFinite(end)) {
		return 0;
	}
	const netProfit = end - start;
	const maxDrawdownAbs = calculateMaxDrawdownAbsolute(values);
	if (!(maxDrawdownAbs > 0)) return 0;
	return netProfit / maxDrawdownAbs;
}

/**
 * Recovery factor from trade-level realized P&Ls.
 * Uses cumulative equity curve starting at 0.
 */
export function calculateRecoveryFactorFromPnls(pnls: number[]): number {
	if (pnls.length === 0) return 0;
	const equityCurve: number[] = [0];
	let running = 0;
	for (const pnl of pnls) {
		running += pnl;
		equityCurve.push(running);
	}
	return calculateRecoveryFactor(equityCurve);
}
