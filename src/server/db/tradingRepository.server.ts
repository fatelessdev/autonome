import { queryOptions } from "@tanstack/react-query";
import { CACHE_TIMING } from "@/core/shared/cache/cacheConfig";
import type { ToolCallTypeValue } from "./tradingRepository";
import * as repo from "./tradingRepository";

// ==========================================
// READ OPERATIONS (Queries)
// ==========================================

export const listModelsQuery = () =>
	queryOptions({
		queryKey: ["models", "list"],
		queryFn: () => repo.listModels(),
		staleTime: Infinity,
		gcTime: Infinity,
	});

export const listModelsOrderedQuery = () =>
	queryOptions({
		queryKey: ["models", "list-ordered"],
		queryFn: () => repo.listModelsOrderedAsc(),
		staleTime: Infinity,
		gcTime: Infinity,
	});

export const portfolioHistoryQuery = (modelId: string) =>
	queryOptions({
		queryKey: ["portfolio-history", modelId],
		queryFn: () => repo.getPortfolioHistory(modelId),
		staleTime: CACHE_TIMING.SLOW,
		gcTime: 10 * CACHE_TIMING.SLOW,
	});

export const recentToolCallsQuery = (params: {
	modelId: string;
	type: ToolCallTypeValue;
	limit?: number;
}) =>
	queryOptions({
		queryKey: ["tool-calls", params.modelId, params.type, params.limit ?? 100],
		queryFn: () => repo.getRecentToolCallsForModel(params),
		staleTime: CACHE_TIMING.REALTIME,
		gcTime: CACHE_TIMING.STATIC,
	});

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
		gcTime: 3 * CACHE_TIMING.SLOW,
	});

export const searchModelsQuery = (params: {
	search?: string;
	limit?: number;
}) =>
	queryOptions({
		queryKey: ["models", "search", params.search, params.limit ?? 10],
		queryFn: () => repo.searchModels(params),
		staleTime: Infinity,
		gcTime: Infinity,
		enabled: !!params.search,
	});

export const portfolioSnapshotsQuery = (params: {
	modelName?: string;
	limit?: number;
}) =>
	queryOptions({
		queryKey: ["portfolio-snapshots", params.modelName, params.limit ?? 60],
		queryFn: () => repo.fetchPortfolioSnapshots(params),
		staleTime: CACHE_TIMING.STANDARD,
		gcTime: 5 * CACHE_TIMING.SLOW,
	});

// ==========================================
// WRITE OPERATIONS
// ==========================================

export const createInvocationMutation = (modelId: string) => {
	return repo.createInvocationRecord(modelId);
};

export const updateInvocationMutation = (params: {
	id: string;
	response: string;
	responsePayload: unknown;
}) => {
	return repo.updateInvocationRecord(params);
};

export const createPortfolioSnapshotMutation = (params: {
	modelId: string;
	netPortfolio: string;
}) => {
	return repo.createPortfolioSnapshot(params.modelId, params.netPortfolio);
};

export const createToolCallMutation = (params: {
	invocationId: string;
	type: ToolCallTypeValue;
	metadata: string;
}) => {
	return repo.createToolCallRecord(params);
};

export const incrementModelUsageMutation = (params: {
	modelId: string;
	deltas: {
		invocationCountDelta?: number;
		totalMinutesDelta?: number;
		failedWorkflowCountDelta?: number;
		failedToolCallCountDelta?: number;
	};
}) => {
	return repo.incrementModelUsage(params.modelId, params.deltas);
};

export const executeUnsafeQueryMutation = (sqlText: string) => {
	return repo.executeUnsafeQuery(sqlText);
};
