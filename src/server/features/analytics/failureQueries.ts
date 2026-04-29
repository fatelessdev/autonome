/**
 * Failure Queries - Database queries for model failure analysis
 */

import { desc, eq, inArray } from "drizzle-orm";
import { toFiniteNumber } from "@/core/shared/trading/calculations";
import type { VariantId } from "@/core/shared/variants";
import { db } from "@/db";
import { invocations, models, toolCalls } from "@/db/schema";
import type {
	FailureEntry,
	ModelFailureStats,
	StepTelemetry,
	ToolCallFailure,
} from "./types";

type VariantFilter = VariantId;

function toNullableString(value: unknown): string | null {
	return typeof value === "string" ? value : null;
}

function normalizeTimestamp(value: unknown): string {
	if (typeof value === "string") {
		return value;
	}

	if (value instanceof Date) {
		return value.toISOString();
	}

	const numericTime = toFiniteNumber(value);
	if (typeof numericTime === "number") {
		return new Date(numericTime).toISOString();
	}

	throw new Error(`Invalid telemetry timestamp: ${String(value)}`);
}

function normalizeStepTelemetry(
	payload: Record<string, unknown> | null,
): StepTelemetry[] | undefined {
	const rawTelemetry = payload?.stepTelemetry;
	if (!Array.isArray(rawTelemetry)) {
		return undefined;
	}

	const normalized = rawTelemetry.map((step, index) => {
		if (!step || typeof step !== "object") {
			throw new Error(`Invalid telemetry step at index ${index}`);
		}

		const typedStep = step as Record<string, unknown>;
		const stepNumber = toFiniteNumber(typedStep.stepNumber);
		const inputTokens = toFiniteNumber(typedStep.inputTokens);
		const outputTokens = toFiniteNumber(typedStep.outputTokens);

		if (stepNumber == null || inputTokens == null || outputTokens == null) {
			throw new Error(`Missing required telemetry fields in step ${index}`);
		}

		const totalTokens =
			toFiniteNumber(typedStep.totalTokens) ?? inputTokens + outputTokens;
		if (!Number.isFinite(totalTokens)) {
			throw new Error(`Invalid totalTokens in telemetry step ${index}`);
		}
		const toolNames = Array.isArray(typedStep.toolNames)
			? typedStep.toolNames.filter(
					(name): name is string => typeof name === "string",
				)
			: [];

		return {
			stepNumber,
			toolNames,
			inputTokens,
			outputTokens,
			totalTokens,
			timestamp: normalizeTimestamp(typedStep.timestamp),
		};
	});

	return normalized.length > 0 ? normalized : undefined;
}

/**
 * Helper to detect if an invocation represents a failure
 */
function isInvocationFailure(
	response: string,
	payload: Record<string, unknown> | null,
	toolCallMetadatas: string[],
): {
	isFailure: boolean;
	isWorkflowFailure: boolean;
	isToolCallFailure: boolean;
} {
	const lowerResponse = response.toLowerCase();

	// Skip placeholder/pending responses - not failures
	if (
		lowerResponse.includes("no response yet") ||
		lowerResponse === "pending" ||
		lowerResponse === ""
	) {
		return {
			isFailure: false,
			isWorkflowFailure: false,
			isToolCallFailure: false,
		};
	}

	// Check for workflow-level failures (errors in response)
	const hasErrorInResponse =
		lowerResponse.includes("error:") ||
		lowerResponse.includes("error occurred") ||
		lowerResponse.includes("failed to") ||
		lowerResponse.includes("aborted") ||
		lowerResponse.includes("exception");

	const failureReason =
		(payload?.failureReason as string) ?? (payload?.error as string) ?? null;

	const isWorkflowFailure = hasErrorInResponse || !!failureReason;

	// Check tool calls for errors
	let isToolCallFailure = false;
	for (const metadata of toolCallMetadatas) {
		try {
			const meta = JSON.parse(metadata);
			if (
				meta?.results?.some?.((r: { success?: boolean }) => r.success === false)
			) {
				isToolCallFailure = true;
				break;
			}
		} catch (error) {
			throw new Error(
				`Invalid tool call metadata JSON while computing failures: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	return {
		isFailure: isWorkflowFailure || isToolCallFailure,
		isWorkflowFailure,
		isToolCallFailure,
	};
}

/**
 * Get failure statistics for all models - computed dynamically from invocations
 */
export async function getModelFailureStats(
	variantFilter?: VariantFilter,
): Promise<ModelFailureStats[]> {
	// Get all models
	const modelQuery = db
		.select({ id: models.id, name: models.name, variant: models.variant })
		.from(models);
	const allModels = await (variantFilter
		? modelQuery.where(eq(models.variant, variantFilter))
		: modelQuery);

	if (allModels.length === 0) return [];

	const modelIds = allModels.map((m) => m.id);

	// Get all invocations for these models
	const invocationRows = await db
		.select({
			id: invocations.id,
			modelId: invocations.modelId,
			response: invocations.response,
			responsePayload: invocations.responsePayload,
		})
		.from(invocations)
		.where(inArray(invocations.modelId, modelIds));

	// Get all tool calls for these invocations
	const invocationIds = invocationRows.map((i) => i.id);
	const toolCallRows =
		invocationIds.length > 0
			? await db
					.select({
						invocationId: toolCalls.invocationId,
						metadata: toolCalls.metadata,
					})
					.from(toolCalls)
					.where(inArray(toolCalls.invocationId, invocationIds))
			: [];

	// Group tool call metadata by invocation
	const toolCallsByInvocation = new Map<string, string[]>();
	for (const tc of toolCallRows) {
		const arr = toolCallsByInvocation.get(tc.invocationId) ?? [];
		arr.push(tc.metadata);
		toolCallsByInvocation.set(tc.invocationId, arr);
	}

	// Count failures per model
	const stats = new Map<
		string,
		{ workflow: number; toolCall: number; total: number }
	>();
	for (const model of allModels) {
		stats.set(model.id, { workflow: 0, toolCall: 0, total: 0 });
	}

	for (const inv of invocationRows) {
		const modelStats = stats.get(inv.modelId);
		if (!modelStats) continue;

		modelStats.total++;

		const payload = inv.responsePayload as Record<string, unknown> | null;
		const tcMetadatas = toolCallsByInvocation.get(inv.id) ?? [];

		const { isWorkflowFailure, isToolCallFailure } = isInvocationFailure(
			inv.response,
			payload,
			tcMetadatas,
		);

		if (isWorkflowFailure) modelStats.workflow++;
		if (isToolCallFailure) modelStats.toolCall++;
	}

	// Build result
	return allModels.map((model) => {
		const modelStats = stats.get(model.id) ?? {
			workflow: 0,
			toolCall: 0,
			total: 0,
		};
		return {
			modelId: model.id,
			modelName: model.name,
			variant: model.variant,
			failedWorkflowCount: modelStats.workflow,
			failedToolCallCount: modelStats.toolCall,
			invocationCount: modelStats.total,
			failureRate:
				modelStats.total > 0
					? ((modelStats.workflow + modelStats.toolCall) / modelStats.total) *
						100
					: 0,
		};
	});
}

/**
 * Get recent failure entries with tool call details
 */
export async function getRecentFailures(
	limit = 50,
	variantFilter?: VariantFilter,
): Promise<FailureEntry[]> {
	// First, get all invocations with their model info
	const invocationQuery = db
		.select({
			id: invocations.id,
			modelId: invocations.modelId,
			modelName: models.name,
			response: invocations.response,
			responsePayload: invocations.responsePayload,
			createdAt: invocations.createdAt,
		})
		.from(invocations)
		.innerJoin(models, eq(invocations.modelId, models.id));

	const invocationRows = await (variantFilter
		? invocationQuery.where(eq(models.variant, variantFilter))
		: invocationQuery
	)
		.orderBy(desc(invocations.createdAt))
		.limit(limit * 2); // Get more to filter for failures

	if (invocationRows.length === 0) return [];

	// Get all tool calls for these invocations
	const invocationIds = invocationRows.map((i) => i.id);
	const toolCallRows = await db
		.select({
			id: toolCalls.id,
			invocationId: toolCalls.invocationId,
			toolCallType: toolCalls.toolCallType,
			metadata: toolCalls.metadata,
			createdAt: toolCalls.createdAt,
		})
		.from(toolCalls)
		.where(inArray(toolCalls.invocationId, invocationIds))
		.orderBy(desc(toolCalls.createdAt));

	// Group tool calls by invocation
	const toolCallsByInvocation = new Map<string, ToolCallFailure[]>();
	for (const tc of toolCallRows) {
		const arr = toolCallsByInvocation.get(tc.invocationId) ?? [];
		arr.push({
			id: tc.id,
			toolCallType: tc.toolCallType,
			metadata: tc.metadata,
			createdAt: tc.createdAt,
		});
		toolCallsByInvocation.set(tc.invocationId, arr);
	}

	// Filter for failures and build entries
	const entries: FailureEntry[] = [];
	for (const inv of invocationRows) {
		const payload = inv.responsePayload as Record<string, unknown> | null;
		const toolCallList = toolCallsByInvocation.get(inv.id) ?? [];
		const tcMetadatas = toolCallList.map((tc) => tc.metadata);

		const { isFailure, isWorkflowFailure } = isInvocationFailure(
			inv.response,
			payload,
			tcMetadatas,
		);

		if (!isFailure) continue;

		// Extract failure reason for display
		const failureReason = isWorkflowFailure
			? (toNullableString(payload?.failureReason) ??
				toNullableString(payload?.error))
			: null;

		// Normalize telemetry fields from JSON payload to match strict API schema.
		const stepTelemetry = normalizeStepTelemetry(payload);
		const totalSteps =
			toFiniteNumber(payload?.totalSteps) ?? stepTelemetry?.length;
		const normalizedInputTokens =
			toFiniteNumber(payload?.totalInputTokens) ??
			stepTelemetry?.reduce((sum, step) => sum + step.inputTokens, 0);
		const normalizedOutputTokens =
			toFiniteNumber(payload?.totalOutputTokens) ??
			stepTelemetry?.reduce((sum, step) => sum + step.outputTokens, 0);
		const totalInputTokens =
			typeof normalizedInputTokens === "number"
				? normalizedInputTokens
				: undefined;
		const totalOutputTokens =
			typeof normalizedOutputTokens === "number"
				? normalizedOutputTokens
				: undefined;

		entries.push({
			invocationId: inv.id,
			modelId: inv.modelId,
			modelName: inv.modelName,
			response: inv.response,
			responsePayload: inv.responsePayload,
			createdAt: inv.createdAt,
			toolCalls: toolCallList,
			failureReason,
			stepTelemetry,
			totalSteps,
			totalInputTokens,
			totalOutputTokens,
		});

		if (entries.length >= limit) break;
	}

	return entries;
}
