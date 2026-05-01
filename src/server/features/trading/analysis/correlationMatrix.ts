/**
 * Correlation Matrix
 *
 * Computes rolling 24h Pearson correlation between all active asset pairs
 * using mid price series from market snapshots. Returns are computed as
 * log-returns of consecutive mid prices within the intraday series.
 *
 * Correlation warnings are generated when r > 0.8 between two assets that
 * are both held or both under consideration for entry.
 *
 * Caching: The full matrix is cached per trade cycle (invalidated alongside
 * the market intelligence cache).
 */

import { CACHE_TIMING } from "@/core/shared/cache/cacheConfig";
import type { MarketSnapshot } from "@/server/features/trading/data/marketData";

// ==========================================
// Types
// ==========================================

export interface CorrelationPair {
	symbolA: string;
	symbolB: string;
	/** Pearson correlation coefficient [-1, 1] */
	correlation: number;
}

export interface CorrelationMatrix {
	pairs: CorrelationPair[];
	/** Number of data points used (after computing returns) */
	dataPoints: number;
	computedAt: number;
}

export interface CorrelationWarning {
	symbolA: string;
	symbolB: string;
	correlation: number;
	message: string;
}

// ==========================================
// Pearson Correlation (pure)
// ==========================================

/**
 * Compute log-returns from a price series.
 * log-returns are preferred over simple returns for correlation because
 * they are additive over time and better approximate normality.
 */
export function computeLogReturns(prices: number[]): number[] {
	const returns: number[] = [];
	for (let i = 1; i < prices.length; i++) {
		if (prices[i - 1] > 0 && prices[i] > 0) {
			returns.push(Math.log(prices[i] / prices[i - 1]));
		}
	}
	return returns;
}

/**
 * Compute Pearson correlation coefficient between two numeric arrays.
 * Returns null if arrays have fewer than 2 elements or are constant.
 *
 * Uses the standard formula:
 *   r = Σ((xi - x̄)(yi - ȳ)) / sqrt(Σ(xi - x̄)² * Σ(yi - ȳ)²)
 */
export function computePearsonCorrelation(
	x: number[],
	y: number[],
): number | null {
	const n = Math.min(x.length, y.length);
	if (n < 2) return null;

	let sumX = 0;
	let sumY = 0;
	for (let i = 0; i < n; i++) {
		sumX += x[i];
		sumY += y[i];
	}
	const meanX = sumX / n;
	const meanY = sumY / n;

	let sumXX = 0;
	let sumYY = 0;
	let sumXY = 0;
	for (let i = 0; i < n; i++) {
		const dx = x[i] - meanX;
		const dy = y[i] - meanY;
		sumXX += dx * dx;
		sumYY += dy * dy;
		sumXY += dx * dy;
	}

	const denom = Math.sqrt(sumXX * sumYY);
	if (denom === 0) return null; // One or both series are constant

	return sumXY / denom;
}

// ==========================================
// Matrix Computation
// ==========================================

const CORRELATION_CACHE_TTL_MS = CACHE_TIMING.MARKET; // 2 minutes (same as market cache)

declare global {
	// eslint-disable-next-line no-var
	var __correlationMatrixCache: CorrelationMatrix | null | undefined;
}

if (typeof globalThis.__correlationMatrixCache === "undefined") {
	globalThis.__correlationMatrixCache = null;
}

/**
 * Extract mid price series from market snapshots.
 * Uses the intraday (5Min) series for recent price data.
 */
function extractPriceSeries(
	snapshots: MarketSnapshot[],
): Map<string, number[]> {
	const series = new Map<string, number[]>();
	for (const snapshot of snapshots) {
		const prices = snapshot.series.intraday.midPrices.filter(
			(p) => Number.isFinite(p) && p > 0,
		);
		if (prices.length >= 2) {
			series.set(snapshot.symbol, prices);
		}
	}
	return series;
}

/**
 * Compute the full pairwise correlation matrix from market snapshots.
 * Uses log-returns of intraday mid prices.
 *
 * Caches the result for the duration of one trade cycle.
 */
export function computeCorrelationMatrix(
	snapshots: MarketSnapshot[],
): CorrelationMatrix {
	// Return cached result if still valid
	const cached = globalThis.__correlationMatrixCache;
	if (cached && Date.now() - cached.computedAt < CORRELATION_CACHE_TTL_MS) {
		return cached;
	}

	const priceSeries = extractPriceSeries(snapshots);
	const symbols = [...priceSeries.keys()].sort();

	// Precompute returns for all symbols
	const returnsMap = new Map<string, number[]>();
	let minDataPoints = Infinity;
	for (const symbol of symbols) {
		const prices = priceSeries.get(symbol);
		if (!prices) continue;
		const returns = computeLogReturns(prices);
		returnsMap.set(symbol, returns);
		minDataPoints = Math.min(minDataPoints, returns.length);
	}

	// Compute pairwise correlations
	const pairs: CorrelationPair[] = [];
	for (let i = 0; i < symbols.length; i++) {
		for (let j = i + 1; j < symbols.length; j++) {
			const symbolA = symbols[i];
			const symbolB = symbols[j];
			const returnsA = returnsMap.get(symbolA);
			const returnsB = returnsMap.get(symbolB);
			if (!returnsA || !returnsB) continue;

			// Align by length (use the shorter series length)
			const n = Math.min(returnsA.length, returnsB.length);
			const correlation =
				computePearsonCorrelation(returnsA.slice(0, n), returnsB.slice(0, n)) ??
				0;

			pairs.push({ symbolA, symbolB, correlation });
		}
	}

	const matrix: CorrelationMatrix = {
		pairs,
		dataPoints: minDataPoints,
		computedAt: Date.now(),
	};

	globalThis.__correlationMatrixCache = matrix;
	return matrix;
}

/**
 * Invalidate the correlation cache.
 * Should be called alongside market intelligence cache invalidation.
 */
export function invalidateCorrelationCache(): void {
	globalThis.__correlationMatrixCache = null;
}

// ==========================================
// Warning Generation
// ==========================================

const CORRELATION_WARNING_THRESHOLD = 0.8;

/**
 * Generate correlation warnings for highly correlated pairs where
 * both assets are currently held or being considered.
 *
 * @param matrix - The computed correlation matrix
 * @param heldSymbols - Set of symbols with open positions
 * @param consideredSymbols - Set of symbols being considered for entry
 * @returns Array of warnings for pairs with r > threshold
 */
export function generateCorrelationWarnings(
	matrix: CorrelationMatrix,
	heldSymbols: Set<string>,
	consideredSymbols: Set<string> = new Set(),
): CorrelationWarning[] {
	// Combine held and considered into a single set of "active" symbols
	const activeSymbols = new Set([...heldSymbols, ...consideredSymbols]);

	const warnings: CorrelationWarning[] = [];

	for (const pair of matrix.pairs) {
		if (Math.abs(pair.correlation) < CORRELATION_WARNING_THRESHOLD) continue;

		const bothActive =
			activeSymbols.has(pair.symbolA) && activeSymbols.has(pair.symbolB);
		if (!bothActive) continue;

		const direction = pair.correlation > 0 ? "positive" : "negative";
		warnings.push({
			symbolA: pair.symbolA,
			symbolB: pair.symbolB,
			correlation: pair.correlation,
			message:
				`${pair.symbolA}-${pair.symbolB} correlation ${pair.correlation.toFixed(2)} (${direction}) — ` +
				`avoid stacking correlated positions.`,
		});
	}

	return warnings;
}

/**
 * Format correlation warnings as a prompt section.
 * Returns empty string if no warnings.
 */
export function formatCorrelationWarnings(
	warnings: CorrelationWarning[],
): string {
	if (warnings.length === 0) return "";

	const lines = ["== CORRELATION WARNINGS =="];
	for (const warning of warnings) {
		lines.push(`⚠ ${warning.message}`);
	}
	return lines.join("\n");
}

/**
 * Get the correlation between two specific symbols from the matrix.
 * Returns null if the pair is not found.
 */
export function getCorrelation(
	matrix: CorrelationMatrix,
	symbolA: string,
	symbolB: string,
): number | null {
	const pair = matrix.pairs.find(
		(p) =>
			(p.symbolA === symbolA && p.symbolB === symbolB) ||
			(p.symbolA === symbolB && p.symbolB === symbolA),
	);
	return pair?.correlation ?? null;
}
