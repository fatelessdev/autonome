/**
 * Welford Service
 *
 * Manages per-model Welford state for running Sharpe ratio computation.
 * State persists in-memory across trade cycles within a process lifetime.
 * On cold start, state is reconstructed from historical portfolio snapshots.
 *
 * Each trade cycle:
 *   1. Portfolio snapshot is recorded (existing flow)
 *   2. This service computes the return from current vs previous snapshot
 *   3. Updates the Welford tracker with the new return
 *   4. Exposes current Sharpe ratio via getSharpeRatio()
 */

import { desc, eq } from "drizzle-orm";
import {
	computePeriodReturn,
	computeSharpeFromWelford,
	createWelfordState,
	type SharpeResult,
	serializeWelfordState,
	type WelfordState,
	welfordUpdate,
} from "@/core/shared/trading/welford";
import { db } from "@/db";
import { portfolioSize } from "@/db/schema";

// ==================== State Storage ====================

/**
 * In-memory Welford state per model.
 * Reconstructed from DB snapshots on cold start.
 */
const welfordStates = new Map<string, WelfordState>();

/**
 * Last known portfolio value per model (for computing period returns).
 */
const lastPortfolioValues = new Map<string, number>();

/**
 * Whether cold-start initialization has been attempted for a model.
 */
const initializedModels = new Set<string>();

// ==================== Constants ====================

/**
 * Number of historical snapshots to bootstrap Welford state from on cold start.
 * Using 200 recent snapshots gives ~16 hours of data at 5-minute intervals.
 * This is enough to reach MIN_SHARPE_SAMPLES (30) quickly.
 */
const BOOTSTRAP_SNAPSHOT_LIMIT = 200;

// ==================== Cold Start ====================

/**
 * Initialize Welford state for a model from historical portfolio snapshots.
 * Queries the most recent snapshots and replays returns through Welford's algorithm.
 */
async function initializeFromHistory(modelId: string): Promise<void> {
	if (initializedModels.has(modelId)) return;
	initializedModels.add(modelId);

	try {
		// Fetch recent snapshots in ascending order (oldest first)
		const snapshots = await db
			.select({
				netPortfolio: portfolioSize.netPortfolio,
				createdAt: portfolioSize.createdAt,
			})
			.from(portfolioSize)
			.where(eq(portfolioSize.modelId, modelId))
			.orderBy(desc(portfolioSize.createdAt))
			.limit(BOOTSTRAP_SNAPSHOT_LIMIT);

		if (snapshots.length < 2) {
			// Not enough history to bootstrap; start fresh
			if (snapshots.length === 1) {
				lastPortfolioValues.set(modelId, Number(snapshots[0].netPortfolio));
			}
			return;
		}

		// Reverse to chronological order (oldest first)
		snapshots.reverse();

		// Initialize Welford state from returns between consecutive snapshots
		const state = createWelfordState();
		for (let i = 1; i < snapshots.length; i++) {
			const prev = Number(snapshots[i - 1].netPortfolio);
			const curr = Number(snapshots[i].netPortfolio);
			const periodReturn = computePeriodReturn(curr, prev);
			if (periodReturn !== null) {
				welfordUpdate(state, periodReturn);
			}
		}

		welfordStates.set(modelId, state);
		lastPortfolioValues.set(
			modelId,
			Number(snapshots[snapshots.length - 1].netPortfolio),
		);

		console.log(
			`[Welford] Bootstrapped ${modelId}: ${state.count} historical returns loaded`,
		);
	} catch (error) {
		console.error(`[Welford] Failed to bootstrap state for ${modelId}:`, error);
		// Start fresh on error
		welfordStates.set(modelId, createWelfordState());
	}
}

// ==================== Public API ====================

/**
 * Update Welford state after a new portfolio snapshot is recorded.
 *
 * Call this from the portfolio snapshot step AFTER the snapshot is written to DB.
 *
 * @param modelId The model whose portfolio was just snapshotted
 * @param currentPortfolioValue The new portfolio value that was just recorded
 */
export async function updateWelfordForModel(
	modelId: string,
	currentPortfolioValue: number,
): Promise<void> {
	// Ensure initialized from history
	if (!initializedModels.has(modelId)) {
		await initializeFromHistory(modelId);
	}

	// Get or create state
	let state = welfordStates.get(modelId);
	if (!state) {
		state = createWelfordState();
		welfordStates.set(modelId, state);
	}

	// Compute return from previous to current
	const previousValue = lastPortfolioValues.get(modelId);
	if (previousValue != null) {
		const periodReturn = computePeriodReturn(
			currentPortfolioValue,
			previousValue,
		);
		if (periodReturn !== null) {
			welfordUpdate(state, periodReturn);
		}
	}

	// Update last known value
	lastPortfolioValues.set(modelId, currentPortfolioValue);
}

/**
 * Get the current Sharpe ratio for a model.
 * Returns an invalid result if insufficient data.
 */
export function getSharpeRatio(modelId: string): SharpeResult {
	const state = welfordStates.get(modelId);
	if (!state) {
		return {
			sharpeRatio: Number.NaN,
			isValid: false,
			reason: "No data available",
			sampleCount: 0,
			meanReturn: 0,
			stdDevReturn: 0,
		};
	}
	return computeSharpeFromWelford(state);
}

/**
 * Get the current Welford state for a model (for serialization/testing).
 */
export function getWelfordState(modelId: string): WelfordState {
	return welfordStates.get(modelId) ?? createWelfordState();
}

/**
 * Serialize all Welford states (for debugging/monitoring).
 */
export function getAllWelfordStates(): Record<
	string,
	{ mean: number; m2: number; count: number }
> {
	const result: Record<string, { mean: number; m2: number; count: number }> =
		{};
	for (const [modelId, state] of welfordStates) {
		result[modelId] = serializeWelfordState(state);
	}
	return result;
}

/**
 * Reset Welford state for a model (for testing).
 */
export function resetWelfordState(modelId: string): void {
	welfordStates.delete(modelId);
	lastPortfolioValues.delete(modelId);
	initializedModels.delete(modelId);
}

/**
 * Reset all Welford state (for testing).
 */
export function resetAllWelfordState(): void {
	welfordStates.clear();
	lastPortfolioValues.clear();
	initializedModels.clear();
}
