/**
 * Leaderboard Queries - Database queries for model performance rankings
 */

import { and, eq, gte, inArray } from "drizzle-orm";
import {
	calculateMaxDrawdown,
	INITIAL_CAPITAL,
} from "@/core/shared/trading/calculations";
import type { VariantId } from "@/core/shared/variants";
import { db } from "@/db";
import { models, portfolioSize } from "@/db/schema";
import type { LeaderboardEntry, LeaderboardWindow } from "./types";

const WINDOW_MS: Record<LeaderboardWindow, number> = {
	"24h": 24 * 60 * 60 * 1000,
	"7d": 7 * 24 * 60 * 60 * 1000,
	"30d": 30 * 24 * 60 * 60 * 1000,
};

type VariantFilter = VariantId;

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
	const byModel = new Map<string, Array<{ t: number; v: number }>>();
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
		const maxDrawdown = calculateMaxDrawdown(points.map((p) => p.v));

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
