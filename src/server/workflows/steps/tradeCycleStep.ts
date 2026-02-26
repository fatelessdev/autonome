/**
 * Trade Cycle Step
 *
 * Durable step that executes trades for all AI models.
 * Automatically retries up to 3 times on failure.
 */
"use step";

import { executeAllModelTrades } from "@/server/features/trading/execution/tradeWorkflow";

export async function tradeCycleStep() {
	return executeAllModelTrades();
}
