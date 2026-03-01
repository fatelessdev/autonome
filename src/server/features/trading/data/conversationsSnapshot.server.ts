import { queryOptions } from "@tanstack/react-query";
import { eq, inArray } from "drizzle-orm";
import { VARIANT_IDS, type VariantId } from "@/core/shared/variants";
import { db } from "@/db";
import { invocations, models } from "@/db/schema";
import {
	parseTradingToolCallMetadata,
	type TradingDecision,
	type TradingDecisionResult,
} from "@/server/features/trading/contracts/tradingDecisions";

function parseToolCallMetadata(
	raw: string,
	toolCallId: string,
): Record<string, unknown> {
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (
			typeof parsed !== "object" ||
			parsed === null ||
			Array.isArray(parsed)
		) {
			throw new Error("metadata must be a JSON object");
		}
		return parsed as Record<string, unknown>;
	} catch (error) {
		throw new Error(
			`Invalid tool call metadata JSON for ${toolCallId}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

export type ConversationSnapshot = {
	id: string;
	modelId: string;
	modelName: string;
	modelVariant?: VariantId;
	modelLogo: string;
	response: string | null;
	responsePayload: unknown;
	timestamp: string;
	toolCalls: Array<{
		id: string;
		type: string;
		metadata: {
			raw: unknown;
			decisions: TradingDecision[];
			results: TradingDecisionResult[];
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
	toolCalls: Array<{ id: string; metadata: string }>,
): boolean {
	if (toolCalls.length === 0) return false;

	// If ALL tool calls are auto-triggered closes, hide the entire invocation
	return toolCalls.every((call) => {
		const metadata = parseToolCallMetadata(call.metadata, call.id);
		return isAutoTriggeredClose(metadata);
	});
}

export async function fetchConversationSnapshots(
	limitPerVariant = 100,
): Promise<ConversationSnapshot[]> {
	// Fetch 100 invocations per variant to ensure fair representation
	const variants = VARIANT_IDS;

	const variantQueries = variants.map((variant) =>
		db.query.invocations.findMany({
			where: inArray(
				invocations.modelId,
				db
					.select({ id: models.id })
					.from(models)
					.where(eq(models.variant, variant)),
			),
			with: {
				model: {
					columns: {
						id: true,
						name: true,
						variant: true,
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
			limit: limitPerVariant,
		}),
	);

	const variantResults = await Promise.all(variantQueries);
	const invocationsWithRelations = variantResults
		.flat()
		.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

	// Filter out invocations that only contain auto-triggered closes
	const filtered = invocationsWithRelations.filter(
		(invocation) => !isAutoTriggeredInvocation(invocation.toolCalls),
	);

	return filtered.map((invocation) => {
		if (!invocation.model) {
			throw new Error(
				`Invocation ${invocation.id} is missing required model relation`,
			);
		}
		if (!invocation.model.openRouterModelName) {
			throw new Error(
				`Invocation ${invocation.id} is missing required model logo/router name`,
			);
		}

		return {
			id: invocation.id,
			modelId: invocation.modelId,
			modelName: invocation.model.name,
			modelVariant: invocation.model.variant,
			modelLogo: invocation.model.openRouterModelName,
			response: invocation.response,
			responsePayload: invocation.responsePayload,
			timestamp: invocation.createdAt.toISOString(),
			toolCalls: invocation.toolCalls.map((toolCall) => {
				const rawMetadata = parseToolCallMetadata(
					toolCall.metadata,
					toolCall.id,
				);
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
		};
	});
}

export async function refreshConversationEvents() {
	const conversations = await fetchConversationSnapshots();
	return conversations;
}

export const conversationsQuery = () =>
	queryOptions({
		queryKey: ["conversations"],
		queryFn: refreshConversationEvents,
		staleTime: 20_000,
		gcTime: 3 * 60_000,
	});
