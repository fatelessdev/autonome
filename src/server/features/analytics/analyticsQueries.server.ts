/**
 * Analytics Queries - Database queries for analytics data
 *
 * Trade analytics, portfolio queries, and model metadata.
 * Leaderboard queries → ./leaderboardQueries.ts
 * Failure analysis queries → ./failureQueries.ts
 */

import { and, asc, desc, eq, inArray, isNotNull } from "drizzle-orm";
import {
	INITIAL_CAPITAL,
	requireFiniteNumber,
	requirePresent,
} from "@/core/shared/trading/calculations";
import type { VariantId } from "@/core/shared/variants";
import { db } from "@/db";
import { models, orders, portfolioSize } from "@/db/schema";
import type { ClosedTradeData } from "./types";

type VariantFilter = VariantId;

export { getModelFailureStats, getRecentFailures } from "./failureQueries";
// Re-export extracted query modules so existing consumers are unaffected
export { getLeaderboardData } from "./leaderboardQueries";

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
		const quantity = requireFiniteNumber(
			row.quantity,
			`closed order ${row.id}.quantity`,
		);
		const entryPrice = requireFiniteNumber(
			row.entryPrice,
			`closed order ${row.id}.entryPrice`,
		);
		const exitPrice = requireFiniteNumber(
			requirePresent(row.exitPrice, `closed order ${row.id}.exitPrice`),
			`closed order ${row.id}.exitPrice`,
		);
		const realizedPnl = requireFiniteNumber(
			requirePresent(row.realizedPnl, `closed order ${row.id}.realizedPnl`),
			`closed order ${row.id}.realizedPnl`,
		);
		const closedAt = requirePresent(
			row.closedAt,
			`closed order ${row.id}.closedAt`,
		);

		const trade: ClosedTradeData = {
			modelId: row.modelId,
			symbol: row.symbol,
			side: row.side,
			quantity,
			entryPrice,
			exitPrice,
			realizedPnl,
			confidence: row.exitPlan?.confidence ?? null,
			openedAt: row.openedAt,
			closedAt,
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
 * Falls back to INITIAL_CAPITAL (100,000) if no snapshots exist
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
		variant: VariantId;
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
