import {
	getRecentToolCallsForModel,
	ToolCallType,
} from "@/server/db/tradingRepository";
import {
	buildDecisionIndex,
	type TradingDecisionWithContext,
} from "@/server/features/trading/contracts/tradingDecisions";

function parseToolCallMetadata(
	raw: string | null,
	toolCallId: string,
): unknown {
	if (!raw) {
		throw new Error(`Missing tool call metadata for ${toolCallId}`);
	}

	try {
		return JSON.parse(raw) as unknown;
	} catch (error) {
		throw new Error(
			`Invalid tool call metadata JSON for ${toolCallId}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

export async function fetchLatestDecisionIndex(
	modelId: string,
): Promise<Map<string, TradingDecisionWithContext>> {
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
			metadata: parseToolCallMetadata(toolCall.metadata, toolCall.id),
		})),
	);
}
