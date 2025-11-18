import { queryOptions } from "@tanstack/react-query";
import type { ToolCallTypeValue } from "./tradingRepository";
import * as repo from "./tradingRepository";

// ==========================================
// READ OPERATIONS (Queries)
// ==========================================

/**
 * List all trading models
 * Cache: 30 seconds (models rarely change)
 */
export const listModelsQuery = () =>
	queryOptions({
		queryKey: ["models", "list"],
		queryFn: () => repo.listModels(),
		staleTime: 30_000, // 30 seconds
		gcTime: 5 * 60_000, // Keep in cache for 5 minutes
	});

/**
 * List models ordered by name (ascending)
 * Cache: 30 seconds
 */
export const listModelsOrderedQuery = () =>
	queryOptions({
		queryKey: ["models", "list-ordered"],
		queryFn: () => repo.listModelsOrderedAsc(),
		staleTime: 30_000,
		gcTime: 5 * 60_000,
	});

/**
 * Get portfolio history for a specific model
 * Cache: 1 minute (updates every minute via scheduler)
 */
export const portfolioHistoryQuery = (modelId: string) =>
	queryOptions({
		queryKey: ["portfolio-history", modelId],
		queryFn: () => repo.getPortfolioHistory(modelId),
		staleTime: 60_000, // 1 minute
		gcTime: 10 * 60_000,
	});

/**
 * Get recent tool calls for a model
 * Cache: 15 seconds (frequently updated)
 */
export const recentToolCallsQuery = (params: {
	modelId: string;
	type: ToolCallTypeValue;
	limit?: number;
}) =>
	queryOptions({
		queryKey: ["tool-calls", params.modelId, params.type, params.limit ?? 100],
		queryFn: () => repo.getRecentToolCallsForModel(params),
		staleTime: 15_000, // 15 seconds
		gcTime: 2 * 60_000,
	});

/**
 * Get recent tool calls with model info
 * Cache: 20 seconds
 */
export const recentToolCallsWithModelQuery = (params: {
	type: ToolCallTypeValue;
	modelName?: string;
	limit?: number;
}) =>
	queryOptions({
		queryKey: [
			"tool-calls-with-model",
			params.type,
			params.modelName,
			params.limit ?? 25,
		],
		queryFn: () => repo.getRecentToolCallsWithModel(params),
		staleTime: 20_000,
		gcTime: 3 * 60_000,
	});

/**
 * Search models by name or OpenRouter model
 * Cache: 10 seconds (search results should be fresh)
 */
export const searchModelsQuery = (params: {
	search?: string;
	limit?: number;
}) =>
	queryOptions({
		queryKey: ["models", "search", params.search, params.limit ?? 10],
		queryFn: () => repo.searchModels(params),
		staleTime: 10_000,
		gcTime: 1 * 60_000,
		enabled: !!params.search, // Only run if search term provided
	});

/**
 * Fetch portfolio snapshots with model info
 * Cache: 30 seconds
 */
export const portfolioSnapshotsQuery = (params: {
	modelName?: string;
	limit?: number;
}) =>
	queryOptions({
		queryKey: ["portfolio-snapshots", params.modelName, params.limit ?? 60],
		queryFn: () => repo.fetchPortfolioSnapshots(params),
		staleTime: 30_000,
		gcTime: 5 * 60_000,
	});

// ==========================================
// WRITE OPERATIONS (Mutation Functions)
// ==========================================

/**
 * Create a new invocation record
 * Use with useMutation hook
 */
export const createInvocationMutation = (modelId: string) => {
	return repo.createInvocationRecord(modelId);
};

/**
 * Update an invocation record
 * Use with useMutation hook
 */
export const updateInvocationMutation = (params: {
	id: string;
	response: string;
	responsePayload: unknown;
}) => {
	return repo.updateInvocationRecord(params);
};

/**
 * Create a portfolio snapshot
 * Use with useMutation hook
 */
export const createPortfolioSnapshotMutation = (params: {
	modelId: string;
	netPortfolio: string;
}) => {
	return repo.createPortfolioSnapshot(params.modelId, params.netPortfolio);
};

/**
 * Create a tool call record
 * Use with useMutation hook
 */
export const createToolCallMutation = (params: {
	invocationId: string;
	type: ToolCallTypeValue;
	metadata: string;
}) => {
	return repo.createToolCallRecord(params);
};

/**
 * Increment model usage counters
 * Use with useMutation hook
 */
export const incrementModelUsageMutation = (params: {
	modelId: string;
	deltas: { invocationCountDelta?: number; totalMinutesDelta?: number };
}) => {
	return repo.incrementModelUsage(params.modelId, params.deltas);
};

/**
 * Execute unsafe SQL query (use with caution)
 * Use with useMutation hook
 */
export const executeUnsafeQueryMutation = (sqlText: string) => {
	return repo.executeUnsafeQuery(sqlText);
};
