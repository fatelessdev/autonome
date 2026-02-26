/**
 * Trading Tools Factory
 * Combines all trading tools into a ToolSet for the agent
 */

import { closePositionTool } from "./closePositionTool";
import { createPositionTool } from "./createPositionTool";
import { fetchIndicatorsTool } from "./fetchIndicatorsTool";
import { holdingTool } from "./holdingTool";
import type { ToolContext } from "./types";

export type { ToolContext } from "./types";

/**
 * Creates all trading tools with shared context.
 * Note: updateExitPlan removed — agents close and reopen with new stops.
 */
export function createTradingTools(ctx: ToolContext) {
	return {
		createPosition: createPositionTool(ctx),
		closePosition: closePositionTool(ctx),
		holding: holdingTool(ctx),
		fetchIndicators: fetchIndicatorsTool,
	};
}

export type TradingTools = ReturnType<typeof createTradingTools>;
