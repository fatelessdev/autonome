/**
 * Welford's Online Algorithm for Running Variance
 *
 * Computes running mean and variance in a single pass without storing
 * all data points. This is numerically stable and memory-efficient.
 *
 * Used for incremental Sharpe ratio computation across trade cycles.
 *
 * Reference: Welford, B.P. (1962). "Note on a Method for Calculating
 * Corrected Sums of Squares and Products."
 */

// ==================== Types ====================

export interface WelfordState {
	/** Running mean of the sample */
	mean: number;
	/** Running sum of squares of deviations from the current mean */
	m2: number;
	/** Number of samples observed */
	count: number;
}

// ==================== Constants ====================

/**
 * Minimum number of observations before Sharpe ratio is considered valid.
 * With fewer data points, the estimate is too noisy to be meaningful.
 */
export const MIN_SHARPE_SAMPLES = 30;

/**
 * Annualization factor for 5-minute observations.
 * 365 days * 24 hours * 12 cycles/hour = 105,120 cycles/year
 */
export const ANNUALIZATION_FACTOR = 365 * 24 * 12;

/**
 * Default risk-free rate (0% for crypto paper trading).
 */
export const RISK_FREE_RATE = 0;

// ==================== Core Algorithm ====================

/**
 * Create an initial (empty) Welford state.
 */
export function createWelfordState(): WelfordState {
	return { mean: 0, m2: 0, count: 0 };
}

/**
 * Update Welford state with a new observation.
 *
 * This is the core of Welford's online algorithm:
 *   count += 1
 *   delta = newValue - mean
 *   mean += delta / count
 *   delta2 = newValue - mean
 *   m2 += delta * delta2
 *
 * @param state Current Welford state (mutated in place and returned)
 * @param newValue New observation to incorporate
 * @returns Updated state (same reference as input)
 */
export function welfordUpdate(state: WelfordState, newValue: number): WelfordState {
	state.count += 1;
	const delta = newValue - state.mean;
	state.mean += delta / state.count;
	const delta2 = newValue - state.mean;
	state.m2 += delta * delta2;
	return state;
}

/**
 * Get the current sample variance from Welford state.
 * Returns 0 if fewer than 2 observations.
 */
export function welfordVariance(state: WelfordState): number {
	if (state.count < 2) return 0;
	return state.m2 / (state.count - 1); // sample variance (Bessel's correction)
}

/**
 * Get the current sample standard deviation from Welford state.
 */
export function welfordStdDev(state: WelfordState): number {
	return Math.sqrt(welfordVariance(state));
}

// ==================== Sharpe Ratio ====================

export interface SharpeResult {
	/** The annualized Sharpe ratio, or NaN if insufficient data */
	sharpeRatio: number;
	/** Whether the result is valid for reporting */
	isValid: boolean;
	/** Human-readable reason if invalid */
	reason?: string;
	/** Number of observations used */
	sampleCount: number;
	/** Running mean of returns */
	meanReturn: number;
	/** Running standard deviation of returns */
	stdDevReturn: number;
}

/**
 * Compute annualized Sharpe ratio from a Welford state of period returns.
 *
 * Formula: Sharpe = (mean_return - risk_free_rate) / std_dev * sqrt(annualization_factor)
 *
 * The annualization_factor converts from per-period to annual:
 *   - 5-minute observations: 365 * 24 * 12 = 105,120
 *   - Daily observations: 365
 *
 * @param state Welford state updated with period returns
 * @param annualizationFactor Number of periods per year (default: 5-min cycles)
 * @param riskFreeRate Annual risk-free rate (default: 0)
 * @returns Sharpe ratio result with validity info
 */
export function computeSharpeFromWelford(
	state: WelfordState,
	annualizationFactor: number = ANNUALIZATION_FACTOR,
	riskFreeRate: number = RISK_FREE_RATE,
): SharpeResult {
	if (state.count < MIN_SHARPE_SAMPLES) {
		return {
			sharpeRatio: Number.NaN,
			isValid: false,
			reason: `Need at least ${MIN_SHARPE_SAMPLES} observations (have ${state.count})`,
			sampleCount: state.count,
			meanReturn: state.mean,
			stdDevReturn: welfordStdDev(state),
		};
	}

	const stdDev = welfordStdDev(state);

	if (stdDev < 1e-10) {
		return {
			sharpeRatio: Number.NaN,
			isValid: false,
			reason: "Volatility too low for meaningful Sharpe",
			sampleCount: state.count,
			meanReturn: state.mean,
			stdDevReturn: stdDev,
		};
	}

	// Annualize: Sharpe_annual = (mean_period - rf_period) / std_period * sqrt(periods_per_year)
	// Since rf is 0, this simplifies to mean / stdDev * sqrt(N)
	const periodRiskFree = riskFreeRate / annualizationFactor;
	const sharpe =
		((state.mean - periodRiskFree) / stdDev) * Math.sqrt(annualizationFactor);

	if (!Number.isFinite(sharpe) || Math.abs(sharpe) > 100) {
		return {
			sharpeRatio: Number.NaN,
			isValid: false,
			reason: "Computed Sharpe out of valid range",
			sampleCount: state.count,
			meanReturn: state.mean,
			stdDevReturn: stdDev,
		};
	}

	return {
		sharpeRatio: sharpe,
		isValid: true,
		sampleCount: state.count,
		meanReturn: state.mean,
		stdDevReturn: stdDev,
	};
}

// ==================== Serialization ====================

/**
 * Serialize Welford state for storage (e.g., JSON).
 */
export function serializeWelfordState(state: WelfordState): {
	mean: number;
	m2: number;
	count: number;
} {
	return { mean: state.mean, m2: state.m2, count: state.count };
}

/**
 * Deserialize Welford state from storage.
 * Returns a fresh state if the input is invalid.
 */
export function deserializeWelfordState(data: unknown): WelfordState {
	if (
		data != null &&
		typeof data === "object" &&
		"mean" in data &&
		"m2" in data &&
		"count" in data
	) {
		const obj = data as { mean: unknown; m2: unknown; count: unknown };
		const mean = Number(obj.mean);
		const m2 = Number(obj.m2);
		const count = Number(obj.count);
		if (Number.isFinite(mean) && Number.isFinite(m2) && Number.isFinite(count) && count >= 0) {
			return { mean, m2, count };
		}
	}
	return createWelfordState();
}

/**
 * Compute portfolio return from consecutive portfolio values.
 * Returns null if previous value is zero or invalid (can't compute a meaningful return).
 */
export function computePeriodReturn(
	currentValue: number,
	previousValue: number,
): number | null {
	if (!Number.isFinite(currentValue) || !Number.isFinite(previousValue)) {
		return null;
	}
	if (previousValue <= 0) {
		return null;
	}
	return (currentValue - previousValue) / previousValue;
}
