import { db } from "@/db";
import { emitConversationEvent } from "@/server/features/trading/events/conversationEvents";
import { parseTradingToolCallMetadata } from "@/server/features/trading/tradingDecisions";
import { safeJsonParse } from "@/utils/json";

export type ConversationSnapshot = {
	id: string;
	modelId: string;
	modelName: string;
	modelLogo: string;
	response: string | null;
	responsePayload: unknown;
	timestamp: string;
	toolCalls: Array<{
		id: string;
		type: string;
		metadata: {
			raw: unknown;
			decisions: unknown;
			results: unknown;
		};
		timestamp: string;
	}>;
};

export async function fetchConversationSnapshots(
	limit = 100,
): Promise<ConversationSnapshot[]> {
	const invocationsWithRelations = await db.query.invocations.findMany({
		with: {
			model: {
				columns: {
					id: true,
					name: true,
					openRouterModelName: true,
				},
			},
			toolCalls: {
				columns: {
					id: true,
					metadata: true,
					toolCallType: true,
					createdAt: true,
				},
				orderBy: (toolCall, { desc: orderDesc }) =>
					orderDesc(toolCall.createdAt),
				limit: 50,
			},
		},
		orderBy: (invocation, { desc: orderDesc }) =>
			orderDesc(invocation.createdAt),
		limit,
	});

	return invocationsWithRelations.map((invocation) => ({
		id: invocation.id,
		modelId: invocation.modelId,
		modelName: invocation.model?.name ?? "Unknown Model",
		modelLogo: invocation.model?.openRouterModelName ?? "unknown-model",
		response: invocation.response,
		responsePayload: invocation.responsePayload,
		timestamp: invocation.createdAt.toISOString(),
		toolCalls: invocation.toolCalls.map((toolCall) => {
			const rawMetadata = safeJsonParse(toolCall.metadata, {});
			const parsed = parseTradingToolCallMetadata(rawMetadata);
			return {
				id: toolCall.id,
				type: toolCall.toolCallType,
				metadata: {
					raw: rawMetadata,
					decisions: parsed.decisions,
					results: parsed.results,
				},
				timestamp: toolCall.createdAt.toISOString(),
			};
		}),
	}));
}

export async function refreshConversationEvents() {
	const conversations = await fetchConversationSnapshots();

	emitConversationEvent({
		type: "conversations:updated",
		timestamp: new Date().toISOString(),
		data: conversations,
	});

	return conversations;
}
