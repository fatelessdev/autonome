import "@/polyfill";

import { os } from "@orpc/server";
import * as Sentry from "@sentry/react";
import { z } from "zod";
import { and, eq, gte, sql } from "drizzle-orm";

import { db } from "@/db";
import { models, orders, portfolioSize } from "@/db/schema";
import {
	VARIANT_IDS,
	VARIANTS,
} from "@/server/features/trading/prompts/variants";

// ==================== Schema Definitions ====================

const VariantIdSchema = z.enum([
	"Situational",
	"Minimal",
	"Guardian",
	"Max",
]);

const VariantSchema = z.object({
	id: VariantIdSchema,
	label: z.string(),
	description: z.string(),
	temperature: z.number(),
	color: z.string(),
});

const VariantListOutputSchema = z.object({
	variants: z.array(VariantSchema),
});

const VariantStatsSchema = z.object({
	variantId: VariantIdSchema,
	label: z.string(),
	color: z.string(),
	totalTrades: z.number(),
	winRate: z.number(),
	totalPnl: z.number(),
	avgPnl: z.number(),
	modelCount: z.number(),
});

const VariantHistoryPointSchema = z.object({
	timestamp: z.string(),
	value: z.number(),
});

const VariantHistoryEntrySchema = z.object({
	variantId: VariantIdSchema,
	label: z.string(),
	color: z.string(),
	history: z.array(VariantHistoryPointSchema),
});

// ==================== Variant Procedures ====================

/**
 * Get list of all available variants with their configuration
 */
export const getVariants = os
	.input(z.object({}))
	.output(VariantListOutputSchema)
	.handler(async () => {
		return Sentry.startSpan({ name: "variants.getVariants" }, async () => {
			const variants = VARIANT_IDS.map((id) => ({
				id,
				label: VARIANTS[id].label,
				description: VARIANTS[id].description,
				temperature: VARIANTS[id].temperature,
				color: VARIANTS[id].color,
			}));
			return { variants };
		});
	});

/**
 * Get aggregated stats for each variant across all models
 */
export const getVariantStats = os
	.input(z.object({}))
	.output(z.object({ stats: z.array(VariantStatsSchema) }))
	.handler(async () => {
		return Sentry.startSpan({ name: "variants.getVariantStats" }, async () => {
			const stats = await Promise.all(
				VARIANT_IDS.map(async (variantId) => {
					// Get all models with this variant
					const variantModels = await db
						.select({ id: models.id })
						.from(models)
						.where(eq(models.variant, variantId));

					const modelIds = variantModels.map((m) => m.id);

					if (modelIds.length === 0) {
						return {
							variantId,
							label: VARIANTS[variantId].label,
							color: VARIANTS[variantId].color,
							totalTrades: 0,
							winRate: 0,
							totalPnl: 0,
							avgPnl: 0,
							modelCount: 0,
						};
					}

					// Get closed orders (trades) for these models
					const closedOrders = await db
						.select({
							realizedPnl: orders.realizedPnl,
						})
						.from(orders)
						.where(
							and(
								eq(orders.status, "CLOSED"),
								sql`${orders.modelId} = ANY(${modelIds})`
							)
						);

					const totalTrades = closedOrders.length;
					const wins = closedOrders.filter(
						(o) => o.realizedPnl && Number(o.realizedPnl) > 0
					).length;
					const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
					const totalPnl = closedOrders.reduce(
						(sum, o) => sum + (Number(o.realizedPnl) || 0),
						0
					);
					const avgPnl = totalTrades > 0 ? totalPnl / totalTrades : 0;

					return {
						variantId,
						label: VARIANTS[variantId].label,
						color: VARIANTS[variantId].color,
						totalTrades,
						winRate,
						totalPnl,
						avgPnl,
						modelCount: modelIds.length,
					};
				})
			);

			return { stats };
		});
	});

/**
 * Get portfolio history for each variant (aggregated across all models in that variant)
 */
export const getVariantHistory = os
	.input(
		z.object({
			window: z.enum(["24h", "7d", "30d"]).default("7d"),
		})
	)
	.output(
		z.object({
			variants: z.array(VariantHistoryEntrySchema),
			aggregate: z.array(VariantHistoryPointSchema),
		})
	)
	.handler(async ({ input }) => {
		return Sentry.startSpan({ name: "variants.getVariantHistory" }, async () => {
			const windowMs =
				input.window === "24h"
					? 24 * 60 * 60 * 1000
					: input.window === "7d"
						? 7 * 24 * 60 * 60 * 1000
						: 30 * 24 * 60 * 60 * 1000;

			const startTime = new Date(Date.now() - windowMs);

			const variants = await Promise.all(
				VARIANT_IDS.map(async (variantId) => {
					// Get all models with this variant
					const variantModels = await db
						.select({ id: models.id })
						.from(models)
						.where(eq(models.variant, variantId));

					const modelIds = variantModels.map((m) => m.id);

					if (modelIds.length === 0) {
						return {
							variantId,
							label: VARIANTS[variantId].label,
							color: VARIANTS[variantId].color,
							history: [],
						};
					}

					// Get portfolio history for these models, grouped by timestamp
					const history = await db
						.select({
							createdAt: portfolioSize.createdAt,
							netPortfolio: portfolioSize.netPortfolio,
						})
						.from(portfolioSize)
						.where(
							and(
								gte(portfolioSize.createdAt, startTime),
								sql`${portfolioSize.modelId} = ANY(${modelIds})`
							)
						)
						.orderBy(portfolioSize.createdAt);

					// Group by hour and average the values
					const hourlyMap = new Map<string, number[]>();
					for (const point of history) {
						const hourKey = new Date(point.createdAt).toISOString().slice(0, 13);
						const values = hourlyMap.get(hourKey) || [];
						values.push(Number(point.netPortfolio));
						hourlyMap.set(hourKey, values);
					}

					const aggregatedHistory = Array.from(hourlyMap.entries()).map(
						([hourKey, values]) => ({
							timestamp: `${hourKey}:00:00.000Z`,
							value: values.reduce((a, b) => a + b, 0) / values.length,
						})
					);

					return {
						variantId,
						label: VARIANTS[variantId].label,
						color: VARIANTS[variantId].color,
						history: aggregatedHistory,
					};
				})
			);

			// Create aggregate by averaging all variants at each timestamp
			const allTimestamps = new Set<string>();
			for (const v of variants) {
				for (const h of v.history) {
					allTimestamps.add(h.timestamp);
				}
			}

			const aggregate = Array.from(allTimestamps)
				.sort()
				.map((timestamp) => {
					const values = variants
						.map((v) => v.history.find((h) => h.timestamp === timestamp)?.value)
						.filter((v): v is number => v !== undefined);
					return {
						timestamp,
						value: values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0,
					};
				});

			return { variants, aggregate };
		});
	});
