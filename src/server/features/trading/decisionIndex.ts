import {
	getRecentToolCallsForModel,
	ToolCallType,
} from "@/server/db/tradingRepository";
import {
	buildDecisionIndex,
	type TradingDecisionWithContext,
} from "@/server/features/trading/tradingDecisions";
import { safeJsonParse } from "@/utils/json";

export async function fetchLatestDecisionIndex(
	modelId: string,
): Promise<Map<string, TradingDecisionWithContext>> {
	try {
		const toolCalls = await getRecentToolCallsForModel({
			modelId,
			type: ToolCallType.CREATE_POSITION,
			limit: 100,
		});

		return buildDecisionIndex(
			toolCalls.map((toolCall) => ({
				id: toolCall.id,
				createdAt: toolCall.createdAt,
				toolCallType: toolCall.toolCallType,
				metadata: safeJsonParse(toolCall.metadata, {}),
			})),
		);
	} catch (error) {
		console.error(`Failed to build decision index for model ${modelId}`, error);
		return new Map<string, TradingDecisionWithContext>();
	}
}
