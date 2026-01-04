import "@/polyfill";

import { os } from "@orpc/server";
import * as Sentry from "@sentry/react";
import { z } from "zod";

import {
	INITIAL_CAPITAL,
	calculateAdvancedStats,
	calculateOverallStats,
	getClosedTradesForModels,
	getModelAccountValues,
	getLeaderboardData,
	getRecentFailures,
	getModelFailureStats,
	getAllModelsWithFailureCounts,
	getRunStartTime,
} from "@/server/features/analytics";

// ==================== Schema Definitions ====================

const OverallStatsSchema = z.object({
	modelId: z.string(),
	modelName: z.string(),
	variant: z.string().optional(),
	accountValue: z.number(),
	returnPercent: z.number(),
	totalPnl: z.number(),
	winRate: z.number(),
	biggestWin: z.number(),
	biggestLoss: z.number(),
	sharpeRatio: z.number(),
	tradesCount: z.number(),
});

const AdvancedStatsSchema = z.object({
	modelId: z.string(),
	modelName: z.string(),
	variant: z.string().optional(),
	accountValue: z.number(),
	avgTradeSize: z.number(),
	medianTradeSize: z.number(),
	maxTradeSize: z.number(),
	avgHoldTimeMinutes: z.number(),
	medianHoldTimeMinutes: z.number(),
	maxHoldTimeMinutes: z.number(),
	longPercent: z.number(),
	expectancy: z.number(),
	avgLeverage: z.number(),
	medianLeverage: z.number(),
	maxLeverage: z.number(),
	avgConfidence: z.number(),
	medianConfidence: z.number(),
	maxConfidence: z.number(),
	failedWorkflowCount: z.number(),
	failedToolCallCount: z.number(),
	invocationCount: z.number(),
	failureRate: z.number(),
});

const VariantFilterSchema = z
	.enum(["all", "Situational", "Minimal", "Guardian", "Max", "Sovereign"])
	.default("all");

const GetAllModelsStatsInputSchema = z.object({
	mode: z.enum(["overall", "advanced"]).default("overall"),
	variant: VariantFilterSchema,
});

const GetAllModelsStatsOutputSchema = z.object({
	overall: z.array(OverallStatsSchema).optional(),
	advanced: z.array(AdvancedStatsSchema).optional(),
});

const LeaderboardEntrySchema = z.object({
	modelId: z.string(),
	modelName: z.string(),
	variant: z.string(),
	pnlPercent: z.number(),
	pnlAbsolute: z.number(),
	maxDrawdown: z.number(),
	startValue: z.number(),
	endValue: z.number(),
});

const GetLeaderboardInputSchema = z.object({
	window: z.enum(["24h", "7d", "30d"]).default("7d"),
	sortBy: z.enum(["pnlPercent", "pnlAbsolute", "maxDrawdown"]).default("pnlPercent"),
	variant: VariantFilterSchema,
});

const GetLeaderboardOutputSchema = z.object({
	entries: z.array(LeaderboardEntrySchema),
	window: z.string(),
});

const ToolCallFailureSchema = z.object({
	id: z.string(),
	toolCallType: z.string(),
	metadata: z.string(),
	createdAt: z.date(),
});

const StepTelemetrySchema = z.object({
	stepNumber: z.number(),
	toolNames: z.array(z.string()),
	inputTokens: z.number(),
	outputTokens: z.number(),
	totalTokens: z.number(),
	timestamp: z.string(),
});

const FailureEntrySchema = z.object({
	invocationId: z.string(),
	modelId: z.string(),
	modelName: z.string(),
	response: z.string(),
	responsePayload: z.unknown(),
	createdAt: z.date(),
	toolCalls: z.array(ToolCallFailureSchema),
	failureReason: z.string().nullable(),
	stepTelemetry: z.array(StepTelemetrySchema).optional(),
	totalSteps: z.number().optional(),
	totalInputTokens: z.number().optional(),
	totalOutputTokens: z.number().optional(),
});

const ModelFailureStatsSchema = z.object({
	modelId: z.string(),
	modelName: z.string(),
	variant: z.string(),
	failedWorkflowCount: z.number(),
	failedToolCallCount: z.number(),
	invocationCount: z.number(),
	failureRate: z.number(),
});

const GetFailuresInputSchema = z.object({
	limit: z.number().min(1).max(100).default(50),
	variant: VariantFilterSchema,
});

const GetFailuresOutputSchema = z.object({
	failures: z.array(FailureEntrySchema),
	modelStats: z.array(ModelFailureStatsSchema),
});

// ==================== Analytics Procedures ====================

export const getModelStats = os
	.input(GetAllModelsStatsInputSchema)
	.output(GetAllModelsStatsOutputSchema)
	.handler(async ({ input }) => {
		return Sentry.startSpan({ name: "analytics.getModelStats" }, async () => {
			const { mode, variant } = input;
			let modelsData = await getAllModelsWithFailureCounts();
			
			// Filter by variant if not "all"
			if (variant !== "all") {
				modelsData = modelsData.filter((m) => m.variant === variant);
			}
			
			const modelIds = modelsData.map((model) => model.id);
			const [tradesByModel, accountValues] = await Promise.all([
				getClosedTradesForModels(modelIds),
				getModelAccountValues(modelIds),
			]);

			if (mode === "overall") {
				const overallStats = modelsData.map((model) => {
					const trades = tradesByModel.get(model.id) ?? [];
					const accountValue = accountValues.get(model.id) ?? INITIAL_CAPITAL;
					return calculateOverallStats(
						model.id,
						model.name,
						trades,
						accountValue,
						model.variant,
					);
				});
				return { overall: overallStats };
			}

			const advancedStats = modelsData.map((model) => {
				const trades = tradesByModel.get(model.id) ?? [];
				const accountValue = accountValues.get(model.id) ?? INITIAL_CAPITAL;
				return calculateAdvancedStats(
					model.id,
					model.name,
					trades,
					accountValue,
					{
						failedWorkflowCount: model.failedWorkflowCount,
						failedToolCallCount: model.failedToolCallCount,
						invocationCount: model.invocationCount,
					},
					model.variant,
				);
			});
			return { advanced: advancedStats };
		});
	});

export const getLeaderboard = os
	.input(GetLeaderboardInputSchema)
	.output(GetLeaderboardOutputSchema)
	.handler(async ({ input }) => {
		return Sentry.startSpan({ name: "analytics.getLeaderboard" }, async () => {
			const { window, sortBy, variant } = input;
			const entries = await getLeaderboardData(window, variant === "all" ? undefined : variant);

			// Sort entries
			const sorted = [...entries].sort((a, b) => {
				if (sortBy === "pnlPercent") {
					return b.pnlPercent - a.pnlPercent;
				}
				if (sortBy === "pnlAbsolute") {
					return b.pnlAbsolute - a.pnlAbsolute;
				}
				// maxDrawdown - lower is better, but for leaderboard we show highest
				return b.maxDrawdown - a.maxDrawdown;
			});

			return { entries: sorted, window };
		});
	});

export const getFailures = os
	.input(GetFailuresInputSchema)
	.output(GetFailuresOutputSchema)
	.handler(async ({ input }) => {
		return Sentry.startSpan({ name: "analytics.getFailures" }, async () => {
			const { limit, variant } = input;
			const variantFilter = variant === "all" ? undefined : variant;
			const [failures, modelStats] = await Promise.all([
				getRecentFailures(limit, variantFilter),
				getModelFailureStats(variantFilter),
			]);
			return { failures, modelStats };
		});
	});

export const getRunInfo = os
	.output(z.object({ runStartTime: z.date().nullable() }))
	.handler(async () => {
		return Sentry.startSpan({ name: "analytics.getRunInfo" }, async () => {
			const runStartTime = await getRunStartTime();
			return { runStartTime };
		});
	});
