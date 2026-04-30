/**
 * Trade Cycle Workflow (Workflow DevKit)
 *
 * Replaces the old setInterval-based scheduler with a durable,
 * crash-recoverable workflow that runs on a configurable interval.
 *
 * Flow:
 *   1. Execute all model trades (step)
 *   2. Record portfolio snapshots (step)
 *   3. Run retention policy periodically (step)
 *   4. Sleep for the configured interval
 *   5. Loop back to step 1
 *
 * "use workflow" marks this file as a sandboxed orchestrator.
 * "use step" marks imported functions as durable steps (auto-retry 3x).
 */
"use workflow";

import { sleep } from "workflow";
import { TRADE_CYCLE_INTERVAL } from "@/core/shared/cache/cacheConfig";
import { portfolioSnapshotStep } from "./steps/portfolioSnapshotStep";
import { retentionPolicyStep } from "./steps/retentionPolicyStep";
import { tradeCycleStep } from "./steps/tradeCycleStep";

/** Run retention policy every N cycles (e.g., every 12 cycles = ~1 hour). */
const RETENTION_EVERY_N_CYCLES = 12;

/**
 * Main trade cycle workflow.
 * Runs indefinitely, executing trades and recording portfolios on each cycle.
 */
export default async function tradeCycleWorkflow() {
	let cycleCount = 0;

	while (true) {
		cycleCount++;
		console.log(`[Workflow] Starting trade cycle #${cycleCount}`);

		// Step 1: Execute all model trades
		const tradeResult = await tradeCycleStep();
		console.log(
			`[Workflow] Trade cycle #${cycleCount} complete: ${tradeResult.successCount}/${tradeResult.totalModels} succeeded`,
		);

		// Step 2: Record portfolio snapshots for all models
		await portfolioSnapshotStep();

		// Step 3: Run retention policy periodically (not every cycle)
		if (cycleCount % RETENTION_EVERY_N_CYCLES === 0) {
			await retentionPolicyStep();
		}

		// Step 4: Sleep until next cycle (suspends without consuming resources)
		await sleep(TRADE_CYCLE_INTERVAL);
	}
}
