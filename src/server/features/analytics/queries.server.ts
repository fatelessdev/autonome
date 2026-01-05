/**
 * Analytics Queries - Database queries for analytics data
 */

import { and, asc, desc, eq, gte, inArray, isNotNull } from "drizzle-orm";

import { db } from "@/db";
import { invocations, models, orders, portfolioSize, toolCalls } from "@/db/schema";
import { INITIAL_CAPITAL } from "./calculations";
import type {
	ClosedTradeData,
	FailureEntry,
	LeaderboardEntry,
	LeaderboardWindow,
	ModelFailureStats,
	StepTelemetry,
	ToolCallFailure,
} from "./types";

const WINDOW_MS: Record<LeaderboardWindow, number> = {
	"24h": 24 * 60 * 60 * 1000,
	"7d": 7 * 24 * 60 * 60 * 1000,
	"30d": 30 * 24 * 60 * 60 * 1000,
};

type VariantFilter = "Guardian" | "Apex" | "Gladiator" | "Sniper" | "Trendsurfer" | "Contrarian";

/**
 * Fetch closed trades for multiple models and group them
 */
export async function getClosedTradesForModels(
	modelIds: string[],
): Promise<Map<string, ClosedTradeData[]>> {
	const grouped = new Map<string, ClosedTradeData[]>();
	if (modelIds.length === 0) {
		return grouped;
	}

	const rows = await db
		.select({
			id: orders.id,
			modelId: orders.modelId,
			symbol: orders.symbol,
			side: orders.side,
			quantity: orders.quantity,
			leverage: orders.leverage,
			entryPrice: orders.entryPrice,
			exitPrice: orders.exitPrice,
			realizedPnl: orders.realizedPnl,
			exitPlan: orders.exitPlan,
			openedAt: orders.openedAt,
			closedAt: orders.closedAt,
		})
		.from(orders)
		.where(
			and(
				inArray(orders.modelId, modelIds),
				eq(orders.status, "CLOSED"),
				isNotNull(orders.closedAt),
			),
		)
		.orderBy(desc(orders.closedAt));

	for (const row of rows) {
		const trade: ClosedTradeData = {
			modelId: row.modelId,
			symbol: row.symbol,
			side: row.side,
			quantity: Number(row.quantity),
			leverage: row.leverage ? Number(row.leverage) : null,
			entryPrice: Number(row.entryPrice),
			exitPrice: row.exitPrice ? Number(row.exitPrice) : 0,
			realizedPnl: row.realizedPnl ? Number(row.realizedPnl) : 0,
			confidence: row.exitPlan?.confidence ?? null,
			openedAt: row.openedAt,
			closedAt: row.closedAt ?? row.openedAt,
		};
		const bucket = grouped.get(row.modelId);
		if (bucket) {
			bucket.push(trade);
		} else {
			grouped.set(row.modelId, [trade]);
		}
	}

	for (const id of modelIds) {
		if (!grouped.has(id)) {
			grouped.set(id, []);
		}
	}

	return grouped;
}

/**
 * Fetch all closed trades for a specific model
 */
export async function getClosedTradesForModel(
	modelId: string,
): Promise<ClosedTradeData[]> {
	const grouped = await getClosedTradesForModels([modelId]);
	return grouped.get(modelId) ?? [];
}

/**
 * Fetch all active models
 */
export async function getAllModels(): Promise<
	Array<{ id: string; name: string }>
> {
	return db.select({ id: models.id, name: models.name }).from(models);
}

/**
 * Get current account value from latest portfolio snapshot
 * Falls back to INITIAL_CAPITAL (10,000) if no snapshots exist
 */
export async function getModelAccountValues(
	modelIds: string[],
): Promise<Map<string, number>> {
	const values = new Map<string, number>();
	if (modelIds.length === 0) {
		return values;
	}

	const rows = await db
		.select({
			modelId: portfolioSize.modelId,
			netPortfolio: portfolioSize.netPortfolio,
			createdAt: portfolioSize.createdAt,
		})
		.from(portfolioSize)
		.where(inArray(portfolioSize.modelId, modelIds))
		.orderBy(desc(portfolioSize.createdAt));

	for (const row of rows) {
		if (values.has(row.modelId)) {
			continue;
		}
		const numericValue = Number(row.netPortfolio);
		values.set(
			row.modelId,
			Number.isFinite(numericValue) ? numericValue : INITIAL_CAPITAL,
		);
	}

	for (const id of modelIds) {
		if (!values.has(id)) {
			values.set(id, INITIAL_CAPITAL);
		}
	}

	return values;
}

export async function getModelAccountValue(modelId: string): Promise<number> {
	const values = await getModelAccountValues([modelId]);
	return values.get(modelId) ?? INITIAL_CAPITAL;
}

/**
 * Get all models with their failure counts
 */
export async function getAllModelsWithFailureCounts(
	variantFilter?: VariantFilter,
): Promise<
	Array<{
		id: string;
		name: string;
		variant: "Guardian" | "Apex" | "Gladiator" | "Sniper" | "Trendsurfer" | "Contrarian";
		failedWorkflowCount: number;
		failedToolCallCount: number;
		invocationCount: number;
	}>
> {
	const baseQuery = db
		.select({
			id: models.id,
			name: models.name,
			variant: models.variant,
			failedWorkflowCount: models.failedWorkflowCount,
			failedToolCallCount: models.failedToolCallCount,
			invocationCount: models.invocationCount,
		})
		.from(models);

	if (!variantFilter) return baseQuery;
	return baseQuery.where(eq(models.variant, variantFilter));
}

/**
 * Compute max drawdown from a series of portfolio values
 * Returns as a positive fraction (e.g., 0.32 = 32% drawdown)
 */
function computeMaxDrawdown(values: number[]): number {
	if (values.length < 2) return 0;
	let peak = values[0];
	let maxDd = 0;
	for (const v of values) {
		if (v > peak) peak = v;
		const dd = (peak - v) / peak; // positive when below peak
		if (dd > maxDd) maxDd = dd;
	}
	return maxDd;
}

/**
 * Get leaderboard data for all models within a time window
 * @param window - Time window to calculate stats for
 * @param variantFilter - Optional variant to filter by (e.g., "Guardian", "Apex", "Contrarian")
 */
export async function getLeaderboardData(
	window: LeaderboardWindow,
	variantFilter?: VariantFilter,
): Promise<LeaderboardEntry[]> {
	const cutoffMs = Date.now() - WINDOW_MS[window];
	const cutoffDate = new Date(cutoffMs);

	const filteredModels = await db
		.select({ id: models.id, name: models.name, variant: models.variant })
		.from(models)
		.where(variantFilter ? eq(models.variant, variantFilter) : undefined);

	if (filteredModels.length === 0) return [];

	const modelIds = filteredModels.map((m) => m.id);

	// Get portfolio history within window for all models
	const portfolioRows = await db
		.select({
			modelId: portfolioSize.modelId,
			netPortfolio: portfolioSize.netPortfolio,
			createdAt: portfolioSize.createdAt,
		})
		.from(portfolioSize)
		.where(
			and(
				inArray(portfolioSize.modelId, modelIds),
				gte(portfolioSize.createdAt, cutoffDate),
			),
		)
		.orderBy(portfolioSize.createdAt);

	// Group by model
	const byModel = new Map<
		string,
		Array<{ t: number; v: number }>
	>();
	for (const row of portfolioRows) {
		const t = row.createdAt.getTime();
		const v = Number(row.netPortfolio);
		if (!Number.isFinite(v)) continue;

		const arr = byModel.get(row.modelId) ?? [];
		arr.push({ t, v });
		byModel.set(row.modelId, arr);
	}

	// Calculate metrics for each model
	const entries: LeaderboardEntry[] = [];
	for (const model of filteredModels) {
		const points = byModel.get(model.id) ?? [];
		if (points.length < 2) {
			// Not enough data in window
			entries.push({
				modelId: model.id,
				modelName: model.name,
				variant: model.variant,
				pnlPercent: 0,
				pnlAbsolute: 0,
				maxDrawdown: 0,
				startValue: INITIAL_CAPITAL,
				endValue: INITIAL_CAPITAL,
			});
			continue;
		}

		// Sort by time
		points.sort((a, b) => a.t - b.t);

		const startValue = points[0].v;
		const endValue = points[points.length - 1].v;
		const pnlAbsolute = endValue - startValue;
		const pnlPercent = startValue !== 0 ? (pnlAbsolute / startValue) * 100 : 0;
		const maxDrawdown = computeMaxDrawdown(points.map((p) => p.v)) * 100;

		entries.push({
			modelId: model.id,
			modelName: model.name,
			variant: model.variant,
			pnlPercent,
			pnlAbsolute,
			maxDrawdown,
			startValue,
			endValue,
		});
	}

	return entries;
}

/**
 * Helper to detect if an invocation represents a failure
 */
function isInvocationFailure(
	response: string,
	payload: Record<string, unknown> | null,
	toolCallMetadatas: string[],
): { isFailure: boolean; isWorkflowFailure: boolean; isToolCallFailure: boolean } {
	const lowerResponse = response.toLowerCase();

	// Skip placeholder/pending responses - not failures
	if (
		lowerResponse.includes("no response yet") ||
		lowerResponse === "pending" ||
		lowerResponse === ""
	) {
		return { isFailure: false, isWorkflowFailure: false, isToolCallFailure: false };
	}

	// Check for workflow-level failures (errors in response)
	const hasErrorInResponse =
		lowerResponse.includes("error:") ||
		lowerResponse.includes("error occurred") ||
		lowerResponse.includes("failed to") ||
		lowerResponse.includes("aborted") ||
		lowerResponse.includes("exception");

	const failureReason =
		(payload?.failureReason as string) ??
		(payload?.error as string) ??
		null;

	const isWorkflowFailure = hasErrorInResponse || !!failureReason;

	// Check tool calls for errors
	let isToolCallFailure = false;
	for (const metadata of toolCallMetadatas) {
		try {
			const meta = JSON.parse(metadata);
			if (meta?.results?.some?.((r: { success?: boolean }) => r.success === false)) {
				isToolCallFailure = true;
				break;
			}
		} catch {
			// Ignore parse errors
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
	const modelQuery = db.select({ id: models.id, name: models.name, variant: models.variant }).from(models);
	const allModels = await (
		variantFilter
			? modelQuery.where(eq(models.variant, variantFilter))
			: modelQuery
	);

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
	const toolCallRows = invocationIds.length > 0
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
	const stats = new Map<string, { workflow: number; toolCall: number; total: number }>();
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
		const modelStats = stats.get(model.id) ?? { workflow: 0, toolCall: 0, total: 0 };
		return {
			modelId: model.id,
			modelName: model.name,
			variant: model.variant,
			failedWorkflowCount: modelStats.workflow,
			failedToolCallCount: modelStats.toolCall,
			invocationCount: modelStats.total,
			failureRate:
				modelStats.total > 0
					? ((modelStats.workflow + modelStats.toolCall) / modelStats.total) * 100
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

	const invocationRows = await (
		variantFilter
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
			? (payload?.failureReason as string) ?? (payload?.error as string) ?? null
			: null;

		// Extract step telemetry from responsePayload
		const stepTelemetry = (payload?.stepTelemetry as StepTelemetry[] | undefined) ?? undefined;
		const totalSteps = (payload?.totalSteps as number | undefined) ?? stepTelemetry?.length;
		const totalInputTokens = (payload?.totalInputTokens as number | undefined) ?? undefined;
		const totalOutputTokens = (payload?.totalOutputTokens as number | undefined) ?? undefined;

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

/**
 * Get the earliest portfolio snapshot timestamp (run start time)
 * Returns null if no snapshots exist
 */
export async function getRunStartTime(): Promise<Date | null> {
	const result = await db
		.select({ createdAt: portfolioSize.createdAt })
		.from(portfolioSize)
		.orderBy(asc(portfolioSize.createdAt))
		.limit(1);

	return result[0]?.createdAt ?? null;
}
