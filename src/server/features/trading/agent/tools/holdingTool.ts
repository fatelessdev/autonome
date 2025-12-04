/**
 * Holding Tool
 * Explicitly passes when no trading action is warranted
 */

import { tool } from "ai";
import { z } from "zod";

import { ToolCallType } from "@/server/db/tradingRepository";
import { createToolCallMutation } from "@/server/db/tradingRepository.server";

import type { ToolContext } from "./types";

/**
 * Creates the holding tool with the given context
 */
export function holdingTool(ctx: ToolContext) {
	return tool({
		description:
			"Explicitly pass when no trading action is warranted this session. Call this when you decide not to trade.",
		inputSchema: z.object({
			reason: z
				.string()
				.max(500)
				.describe(
					"Brief reason for holding (max 500 chars): primary market condition or constraint",
				),
		}),
		execute: async ({ reason }) => {
			// Record holding decision for telemetry
			await createToolCallMutation({
				invocationId: ctx.invocationId,
				type: ToolCallType.CREATE_POSITION,
				metadata: JSON.stringify({
					action: "holding",
					reason,
					timestamp: new Date().toISOString(),
				}),
			});

			return `Holding: ${reason}`;
		},
	});
}
