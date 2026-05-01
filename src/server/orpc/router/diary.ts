import "@/polyfill";

import { os } from "@orpc/server";
import * as Sentry from "@sentry/react";
import { z } from "zod";

import { variantIdSchema } from "@/core/shared/variants";
import {
	encodeCursor,
	queryDecisionDiary,
	queryMarketState,
} from "@/server/db/tradingRepository";

// ==================== Schema Definitions ====================

const DecisionSchema = z.object({
	symbol: z.string(),
	side: z.enum(["LONG", "SHORT", "HOLD"]),
	confidence: z.number().nullable(),
	reasoningSummary: z.string().nullable(),
});

const MarketSnapshotSchema = z.object({
	adx: z.number().nullable(),
	regime: z.enum(["trending", "ranging", "choppy"]).nullable(),
	bbandsPosition: z.enum(["upper", "middle", "lower"]).nullable(),
	supertrendDirection: z.enum(["long", "short"]).nullable(),
});

const ModelStateSchema = z.object({
	cash: z.number(),
	exposurePct: z.number(),
	portfolioValue: z.number(),
	openPositionsCount: z.number(),
});

const TopMoverSchema = z.object({
	symbol: z.string(),
	changePct: z.number(),
});

const ActiveCorrelationSchema = z.object({
	symbolA: z.string(),
	symbolB: z.string(),
	correlation: z.number(),
});

const OpenInterestEntrySchema = z.object({
	symbol: z.string(),
	openInterest: z.number(),
	openInterestValueUsd: z.number(),
	changePercent: z.number(),
});

const MarketStateEntrySchema = z.object({
	id: z.string(),
	modelId: z.string(),
	regime: z.string().nullable(),
	adxValue: z.string().nullable(),
	topMovers: z.array(TopMoverSchema),
	activeCorrelations: z.array(ActiveCorrelationSchema),
	openInterestSummary: z.array(OpenInterestEntrySchema).nullable(),
	recordedAt: z.date(),
});

const DecisionDiaryEntrySchema = z.object({
	id: z.string(),
	modelId: z.string(),
	invocationId: z.string(),
	variant: z.string(),
	decisions: z.array(DecisionSchema),
	marketSnapshot: MarketSnapshotSchema,
	modelState: ModelStateSchema,
	createdAt: z.date(),
});

const DecisionDiaryWithMarketStateSchema = DecisionDiaryEntrySchema.extend({
	nearestMarketState: MarketStateEntrySchema.nullable().optional(),
});

// ==================== Input Schemas ====================

const GetDecisionDiaryInputSchema = z.object({
	variant: variantIdSchema.optional(),
	symbol: z.string().optional(),
	dateFrom: z.string().datetime().optional(),
	dateTo: z.string().datetime().optional(),
	modelId: z.string().optional(),
	includeMarketState: z.boolean().default(false),
	limit: z.number().int().min(1).max(100).default(50),
	cursor: z.string().optional(),
});

const GetMarketStateInputSchema = z.object({
	modelId: z.string().optional(),
	dateFrom: z.string().datetime().optional(),
	dateTo: z.string().datetime().optional(),
	regime: z.string().optional(),
	limit: z.number().int().min(1).max(100).default(50),
	cursor: z.string().optional(),
});

// ==================== Output Schemas ====================

const GetDecisionDiaryOutputSchema = z.object({
	entries: z.array(DecisionDiaryWithMarketStateSchema),
	nextCursor: z.string().nullable(),
});

const GetMarketStateOutputSchema = z.object({
	entries: z.array(MarketStateEntrySchema),
	nextCursor: z.string().nullable(),
});

// ==================== Analytics Procedures ====================

/**
 * Query decision diary entries with filters.
 *
 * Supports filtering by variant, symbol (matches against decisions array),
 * date range, modelId. Paginated via cursor (descending createdAt).
 *
 * When includeMarketState is true, each entry is augmented with the nearest
 * prior MarketState for the same modelId (temporal join).
 */
export const getDecisionDiary = os
	.input(GetDecisionDiaryInputSchema)
	.output(GetDecisionDiaryOutputSchema)
	.handler(async ({ input }) => {
		return Sentry.startSpan(
			{ name: "analytics.getDecisionDiary" },
			async () => {
				const entries = await queryDecisionDiary({
					variant: input.variant,
					symbol: input.symbol,
					dateFrom: input.dateFrom ? new Date(input.dateFrom) : undefined,
					dateTo: input.dateTo ? new Date(input.dateTo) : undefined,
					modelId: input.modelId,
					includeMarketState: input.includeMarketState,
					limit: input.limit,
					cursor: input.cursor,
				});

				let nextCursor: string | null = null;
				if (entries.length === input.limit) {
					const last = entries[entries.length - 1];
					if (last) {
						nextCursor = encodeCursor(last.createdAt, last.id);
					}
				}

				return { entries, nextCursor };
			},
		);
	});

/**
 * Query market state entries with filters.
 *
 * Supports filtering by modelId, date range, regime.
 * Paginated via cursor (descending recordedAt).
 */
export const getMarketState = os
	.input(GetMarketStateInputSchema)
	.output(GetMarketStateOutputSchema)
	.handler(async ({ input }) => {
		return Sentry.startSpan({ name: "analytics.getMarketState" }, async () => {
			const entries = await queryMarketState({
				modelId: input.modelId,
				dateFrom: input.dateFrom ? new Date(input.dateFrom) : undefined,
				dateTo: input.dateTo ? new Date(input.dateTo) : undefined,
				regime: input.regime,
				limit: input.limit,
				cursor: input.cursor,
			});

			let nextCursor: string | null = null;
			if (entries.length === input.limit) {
				const last = entries[entries.length - 1];
				if (last) {
					nextCursor = encodeCursor(last.recordedAt, last.id);
				}
			}

			return { entries, nextCursor };
		});
	});
