import { db } from "@/db";
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

/**
 * Check if a tool call is an auto-triggered close (stop-loss or take-profit).
 * These should not appear in the model chat as they're system-initiated.
 */
function isAutoTriggeredClose(metadata: Record<string, unknown>): boolean {
	return (
		typeof metadata.autoTrigger === "string" &&
		(metadata.autoTrigger === "STOP" || metadata.autoTrigger === "TARGET")
	);
}

/**
 * Check if an invocation only contains auto-triggered actions.
 * If so, it should be filtered out from the conversation view entirely.
 */
function isAutoTriggeredInvocation(
	toolCalls: Array<{ metadata: string }>,
): boolean {
	if (toolCalls.length === 0) return false;

	// If ALL tool calls are auto-triggered closes, hide the entire invocation
	return toolCalls.every((call) => {
		const metadata = safeJsonParse<Record<string, unknown>>(call.metadata, {});
		return isAutoTriggeredClose(metadata);
	});
}

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

	// Filter out invocations that only contain auto-triggered closes
	const filtered = invocationsWithRelations.filter(
		(invocation) => !isAutoTriggeredInvocation(invocation.toolCalls),
	);

	return filtered.map((invocation) => ({
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
	return conversations;
}
