import { z } from "zod";

import { variantIdSchema } from "@/core/shared/variants";

// ==================== Common Schemas ====================

export const TodoSchema = z.object({
	id: z.number().int().min(1),
	name: z.string(),
});

// ==================== Trading Schemas ====================

export const TradeSchema = z.object({
	id: z.string(),
	modelId: z.string(),
	modelName: z.string(),
	modelVariant: variantIdSchema.optional(),
	modelRouterName: z.string().optional(),
	modelKey: z.string().optional(),
	side: z.enum(["long", "short"]),
	symbol: z.string(),
	entryPrice: z.number(),
	exitPrice: z.number(),
	quantity: z.number(),
	netPnl: z.number(),
	openedAt: z.string(),
	closedAt: z.string(),
	holdingTime: z.string().optional(),
	timestamp: z.string(),
});

export const TradesResponseSchema = z.object({
	trades: z.array(TradeSchema),
});

// ==================== Position Schemas ====================

export const ExitPlanSchema = z.object({
	target: z.number().nullable().optional(),
	stop: z.number().nullable().optional(),
	invalidation: z.string().nullable().optional(),
});

export const PositionSchema = z.object({
	symbol: z.string(),
	side: z.enum(["long", "short"]),
	quantity: z.number(),
	entryPrice: z.number(),
	notional: z.number().optional(),
	currentPrice: z.number().optional(),
	unrealizedPnl: z.number().optional(),
	exitPlan: ExitPlanSchema.optional(),
	confidence: z.number().optional(),
	lastDecisionAt: z.string().optional(),
	decisionStatus: z.string().optional(),
});

export const AccountPositionsSchema = z.object({
	modelId: z.string(),
	modelName: z.string(),
	modelVariant: variantIdSchema.optional(),
	modelLogo: z.string().optional(),
	positions: z.array(PositionSchema),
	totalUnrealizedPnl: z.number().optional(),
});

export const PositionsResponseSchema = z.object({
	positions: z.array(AccountPositionsSchema),
});

// ==================== Crypto Price Schemas ====================

export const CryptoPriceSchema = z.object({
	symbol: z.string(),
	price: z.number(),
	message: z.string().optional(),
});

export const CryptoPricesInputSchema = z.object({
	symbols: z.array(z.string()).optional(),
});

export const CryptoPricesResponseSchema = z.object({
	prices: z.array(CryptoPriceSchema),
});

// ==================== Portfolio History Schemas ====================

export const PortfolioSnapshotSchema = z.object({
	id: z.string(),
	modelId: z.string(),
	netPortfolio: z.string(),
	createdAt: z.string(),
	updatedAt: z.string(),
	model: z
		.object({
			name: z.string(),
			variant: variantIdSchema.optional(),
			openRouterModelName: z.string().optional(),
		})
		.optional(),
});

export const DownsampleResolutionSchema = z.enum([
	"1m",
	"5m",
	"15m",
	"1h",
	"4h",
]);

export const PortfolioHistoryResponseSchema = z.object({
	history: z.array(PortfolioSnapshotSchema),
	resolution: DownsampleResolutionSchema,
});

// ==================== Models Schemas ====================

export const ModelSchema = z.object({
	id: z.string(),
	name: z.string(),
});

export const ModelsResponseSchema = z.object({
	models: z.array(ModelSchema),
	warning: z.string().optional(),
});

// ==================== Invocations Schemas ====================

export const InvocationSchema = z.object({
	id: z.string(),
	modelId: z.string(),
	modelName: z.string(),
	modelVariant: variantIdSchema.optional(),
	modelLogo: z.string(),
	response: z.string().nullable(),
	responsePayload: z.any().optional(),
	timestamp: z.string(),
	toolCalls: z.array(
		z.object({
			id: z.string(),
			type: z.string(),
			metadata: z.object({
				raw: z.any(),
				decisions: z.array(z.any()),
				results: z.array(z.any()),
			}),
			timestamp: z.string(),
		}),
	),
});

export const InvocationsResponseSchema = z.object({
	conversations: z.array(InvocationSchema),
});

// Alpaca paper trading is the only supported execution path.

// ==================== Health Schemas ====================

export const SchedulerHealthSchema = z.object({
	healthy: z.boolean(),
	lastRun: z.string().nullable(),
	ageMs: z.number().nullable(),
});

export const HealthResponseSchema = z.object({
	status: z.enum(["ok", "degraded"]),
	timestamp: z.string(),
	serverStartedAt: z.string().optional(),
	uptimeSeconds: z.number().optional(),
	schedulers: z.object({
		trade: SchedulerHealthSchema,
		portfolio: SchedulerHealthSchema,
	}),
});

export const RunningModelSchema = z.object({
	id: z.string(),
	runningForSeconds: z.number().nullable(),
});

export const CycleStatsSchema = z.object({
	successCount: z.number(),
	failureCount: z.number(),
	totalModels: z.number(),
	timestamp: z.string(),
});

export const DetailedHealthResponseSchema = z.object({
	timestamp: z.string(),
	serverStartedAt: z.string().optional(),
	uptimeSeconds: z.number().optional(),
	tradeScheduler: z.object({
		lastRun: z.string().nullable(),
		ageSeconds: z.number().nullable(),
		modelsCurrentlyRunning: z.array(RunningModelSchema),
		workflowManaged: z.boolean(),
		lastSuccessfulCompletion: z.string().nullable(),
		lastSuccessAge: z.number().nullable(),
		lastCycleStats: CycleStatsSchema.nullable(),
		consecutiveFailedCycles: z.number(),
	}),
	portfolioScheduler: z.object({
		lastRun: z.string().nullable(),
		ageSeconds: z.number().nullable(),
		workflowManaged: z.boolean(),
		initialized: z.boolean(),
	}),
});
