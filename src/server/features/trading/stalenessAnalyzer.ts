/**
 * Position Staleness Analyzer
 *
 * Computes a 0-100 composite staleness score for open positions across
 * three dimensions:
 *   - Time held (max 40pts): 0 below 2 days, linear 2-3 days, full at 3+ days
 *   - P&L action (max 30pts): scaled by loss magnitude, 15pts if held 2+ days with <3% gain
 *   - Funding cost (max 30pts): accumulated funding cost ratio
 *
 * Positions under 24h are excluded (grace period).
 * Flagged as STALE when score >= 70 OR (held >= 3 days AND gain < 5%).
 */

// ==========================================
// Types
// ==========================================

export interface StalenessInput {
	/** When the position was opened */
	entryTime: Date;
	/** Current unrealized P&L in USD */
	unrealizedPnl: number;
	/** Total cost basis (avg_entry_price × qty). Null if unavailable. */
	costBasis: number | null;
	/** Current notional value in USD. Null if unavailable. */
	notionalUsd: number | null;
	/** Accumulated funding cost in USD. Null if unavailable (common for spot/paper). */
	fundingCostUsd: number | null;
}

export interface StalenessScore {
	/** Composite score 0-100 */
	score: number;
	/** Time held dimension (0-40) */
	timeHeldScore: number;
	/** P&L action dimension (0-30) */
	pnlActionScore: number;
	/** Funding cost dimension (0-30) */
	fundingCostScore: number;
	/** Whether position is flagged as STALE */
	isStale: boolean;
	/** Hours position has been held */
	hoursHeld: number;
}

// ==========================================
// Constants
// ==========================================

const GRACE_PERIOD_HOURS = 24;

const TIME_HELD_MAX = 40;
const TIME_HELD_START_DAYS = 2;
const TIME_HELD_FULL_DAYS = 3;

const PNL_ACTION_MAX = 30;
const PNL_LOSS_CAP_PERCENT = 10;
const PNL_MID_GAIN_THRESHOLD_PERCENT = 3;

const FUNDING_COST_MAX = 30;
const FUNDING_COST_CAP_RATIO = 0.001; // 0.1% ratio = max score

const STALE_SCORE_THRESHOLD = 70;
const STALE_DAYS_THRESHOLD = 3;
const STALE_GAIN_THRESHOLD_PERCENT = 5;

// ==========================================
// Computation
// ==========================================

/**
 * Compute staleness score for a single position.
 * Returns null if the position is within the 24h grace period.
 */
export function computeStalenessScore(
	input: StalenessInput,
	now: Date = new Date(),
): StalenessScore | null {
	const hoursHeld =
		(now.getTime() - input.entryTime.getTime()) / (1000 * 60 * 60);

	// Grace period: exclude positions under 24h
	if (hoursHeld < GRACE_PERIOD_HOURS) {
		return null;
	}

	const daysHeld = hoursHeld / 24;

	// --- Time held dimension (max 40pts) ---
	let timeHeldScore: number;
	if (daysHeld < TIME_HELD_START_DAYS) {
		timeHeldScore = 0;
	} else if (daysHeld >= TIME_HELD_FULL_DAYS) {
		timeHeldScore = TIME_HELD_MAX;
	} else {
		// Linear ramp from 2 to 3 days
		const fraction =
			(daysHeld - TIME_HELD_START_DAYS) /
			(TIME_HELD_FULL_DAYS - TIME_HELD_START_DAYS);
		timeHeldScore = fraction * TIME_HELD_MAX;
	}

	// --- P&L action dimension (max 30pts) ---
	const pnlActionScore = computePnlActionScore(
		input.unrealizedPnl,
		input.costBasis,
		input.notionalUsd,
		daysHeld,
	);

	// --- Funding cost dimension (max 30pts) ---
	const fundingCostScore = computeFundingCostScore(
		input.fundingCostUsd,
		input.costBasis,
		input.notionalUsd,
	);

	// --- Composite score ---
	const rawScore = timeHeldScore + pnlActionScore + fundingCostScore;
	const score = Math.min(Math.round(rawScore), 100);

	// --- STALE flag ---
	const isStale = checkStale(
		score,
		daysHeld,
		input.unrealizedPnl,
		input.costBasis,
		input.notionalUsd,
	);

	return {
		score,
		timeHeldScore: round1(timeHeldScore),
		pnlActionScore: round1(pnlActionScore),
		fundingCostScore: round1(fundingCostScore),
		isStale,
		hoursHeld: round1(hoursHeld),
	};
}

// ==========================================
// Dimension helpers
// ==========================================

function computePnlActionScore(
	unrealizedPnl: number,
	costBasis: number | null,
	notionalUsd: number | null,
	daysHeld: number,
): number {
	const base =
		costBasis !== null && costBasis > 0
			? costBasis
			: notionalUsd !== null && notionalUsd > 0
				? notionalUsd
				: null;
	if (base === null) return 0;

	const gainPercent = (unrealizedPnl / base) * 100;

	if (gainPercent < 0) {
		// Losing: scale by loss magnitude, max at -10%
		const lossMagnitude = Math.min(Math.abs(gainPercent), PNL_LOSS_CAP_PERCENT);
		return (lossMagnitude / PNL_LOSS_CAP_PERCENT) * PNL_ACTION_MAX;
	}

	if (
		daysHeld >= TIME_HELD_START_DAYS &&
		gainPercent < PNL_MID_GAIN_THRESHOLD_PERCENT
	) {
		// Held 2+ days with <3% gain: half points
		return PNL_ACTION_MAX / 2;
	}

	return 0;
}

function computeFundingCostScore(
	fundingCostUsd: number | null,
	costBasis: number | null,
	notionalUsd: number | null,
): number {
	if (fundingCostUsd === null || fundingCostUsd <= 0) return 0;

	const base =
		costBasis !== null && costBasis > 0
			? costBasis
			: notionalUsd !== null && notionalUsd > 0
				? notionalUsd
				: null;
	if (base === null) return 0;

	const fundingRatio = fundingCostUsd / base;
	return Math.min(
		(fundingRatio / FUNDING_COST_CAP_RATIO) * FUNDING_COST_MAX,
		FUNDING_COST_MAX,
	);
}

function checkStale(
	score: number,
	daysHeld: number,
	unrealizedPnl: number,
	costBasis: number | null,
	notionalUsd: number | null,
): boolean {
	if (score >= STALE_SCORE_THRESHOLD) return true;

	if (daysHeld >= STALE_DAYS_THRESHOLD) {
		const base =
			costBasis !== null && costBasis > 0
				? costBasis
				: notionalUsd !== null && notionalUsd > 0
					? notionalUsd
					: null;
		if (base !== null) {
			const gainPercent = (unrealizedPnl / base) * 100;
			if (gainPercent < STALE_GAIN_THRESHOLD_PERCENT) return true;
		}
	}

	return false;
}

// ==========================================
// Utilities
// ==========================================

function round1(value: number): number {
	return Math.round(value * 10) / 10;
}
