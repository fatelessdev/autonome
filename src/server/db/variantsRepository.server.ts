import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { models, orders, portfolioSize } from "@/db/schema";

// ==========================================
// Repository Functions for Variants Router
// ==========================================

/**
 * Get all model IDs belonging to a specific variant.
 */
export async function getVariantModelIds(variantId: string): Promise<string[]> {
	const rows = await db
		.select({ id: models.id })
		.from(models)
		.where(
			eq(
				models.variant,
				variantId as "Trendsurfer" | "Contrarian" | "Sovereign",
			),
		);

	return rows.map((m) => m.id);
}

/**
 * Get closed orders for a set of model IDs.
 * Returns only the realizedPnl field for aggregation.
 */
export async function getClosedOrdersByModelIds(
	modelIds: string[],
): Promise<{ realizedPnl: string | null }[]> {
	return db
		.select({
			realizedPnl: orders.realizedPnl,
		})
		.from(orders)
		.where(
			and(
				eq(orders.status, "CLOSED"),
				sql`${orders.modelId} = ANY(${modelIds})`,
			),
		);
}

/**
 * Get portfolio history for a set of model IDs since a given start time.
 * Returns createdAt and netPortfolio for time-series aggregation.
 */
export async function getPortfolioHistoryByModelIds(
	modelIds: string[],
	startTime: Date,
): Promise<{ createdAt: Date; netPortfolio: string }[]> {
	return db
		.select({
			createdAt: portfolioSize.createdAt,
			netPortfolio: portfolioSize.netPortfolio,
		})
		.from(portfolioSize)
		.where(
			and(
				gte(portfolioSize.createdAt, startTime),
				sql`${portfolioSize.modelId} = ANY(${modelIds})`,
			),
		)
		.orderBy(portfolioSize.createdAt);
}
