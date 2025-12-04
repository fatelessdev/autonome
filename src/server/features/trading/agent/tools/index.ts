/**
 * Trading Tools Factory
 * Combines all trading tools into a ToolSet for the agent
 */

import { createPositionTool } from "./createPositionTool";
import { closePositionTool } from "./closePositionTool";
import { updateExitPlanTool } from "./updateExitPlanTool";
import { holdingTool } from "./holdingTool";
import type { ToolContext } from "./types";

export { type ToolContext } from "./types";

/**
 * Creates all trading tools with shared context
 */
export function createTradingTools(ctx: ToolContext) {
	return {
		createPosition: createPositionTool(ctx),
		closePosition: closePositionTool(ctx),
		updateExitPlan: updateExitPlanTool(ctx),
		holding: holdingTool(ctx),
	};
}

export type TradingTools = ReturnType<typeof createTradingTools>;
