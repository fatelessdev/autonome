"use step";

import { executeAllModelTrades } from "@/server/features/trading/execution/tradeWorkflow";

export async function tradeCycleStep() {
	return await executeAllModelTrades();
}
