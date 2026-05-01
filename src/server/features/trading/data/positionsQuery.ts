/**
 * Positions query — fetches live Alpaca positions enriched with DB metadata.
 */

import { queryOptions } from "@tanstack/react-query";
import { eq } from "drizzle-orm";
import { CACHE_TIMING } from "@/core/shared/cache/cacheConfig";
import {
	requireFiniteNumber,
	requirePresent,
} from "@/core/shared/trading/calculations";
import { isValidVariantId, type VariantId } from "@/core/shared/variants";
import { db } from "@/db";
import { models } from "@/db/schema";
import { fetchLatestDecisionIndex } from "@/server/features/trading/contracts/decisionIndex";
import { enrichOpenPositions } from "@/server/features/trading/data/openPositionEnrichment";
import { getOpenPositions } from "@/server/features/trading/data/positions";

// ==========================================
// HELPERS
// ==========================================

const requireModelCredentials = (model: {
	id: string;
	alpacaApiKey: string | null;
	alpacaApiSecret: string | null;
}): { apiKey: string; apiSecret: string } => {
	if (!model.alpacaApiKey || !model.alpacaApiSecret) {
		throw new Error(`Missing Alpaca credentials for model ${model.id}`);
	}
	return {
		apiKey: model.alpacaApiKey,
		apiSecret: model.alpacaApiSecret,
	};
};

// ==========================================
// QUERY
// ==========================================

export type FetchPositionsOptions = {
	variant?: VariantId;
};

export const positionsQuery = (options?: FetchPositionsOptions) =>
	queryOptions({
		queryKey: ["positions", options?.variant ?? "all"],
		queryFn: () => fetchPositions(options),
		staleTime: CACHE_TIMING.REALTIME,
		gcTime: CACHE_TIMING.STATIC,
		refetchInterval: CACHE_TIMING.STANDARD,
	});

export async function fetchPositions(options?: FetchPositionsOptions) {
	const { variant } = options ?? {};
	const normalizedVariant = isValidVariantId(variant) ? variant : undefined;

	const modelFilter = normalizedVariant
		? eq(models.variant, normalizedVariant)
		: undefined;

	const dbModels = await db
		.select({
			id: models.id,
			name: models.name,
			modelLogo: models.openRouterModelName,
			variant: models.variant,
			alpacaApiKey: models.alpacaApiKey,
			alpacaApiSecret: models.alpacaApiSecret,
			invocationCount: models.invocationCount,
			totalMinutes: models.totalMinutes,
		})
		.from(models)
		.where(modelFilter);

	const results = await Promise.all(
		dbModels.map(async (model) => {
			const { apiKey, apiSecret } = requireModelCredentials(model);

			const [livePositionsRaw, decisionIndex] = await Promise.all([
				getOpenPositions({
					id: model.id,
					name: model.name,
					modelName: model.modelLogo,
					alpacaApiKey: apiKey,
					alpacaApiSecret: apiSecret,
					invocationCount: model.invocationCount,
					totalMinutes: model.totalMinutes,
					variant: model.variant,
				}),
				fetchLatestDecisionIndex(model.id),
			]);

			const livePositions = enrichOpenPositions(
				livePositionsRaw,
				decisionIndex,
			);

			const positions = livePositions.map((pos) => {
				const entryPrice = requirePresent(
					pos.entryPrice,
					`open position ${pos.symbol} on model ${model.id}.entryPrice`,
				);
				const notional = requirePresent(
					pos.notional,
					`open position ${pos.symbol} on model ${model.id}.notional`,
				);

				return {
					symbol: pos.symbol,
					position: pos.position,
					side: pos.side,
					quantity: pos.quantity,
					entryPrice,
					markPrice: pos.markPrice ?? null,
					currentPrice: pos.markPrice ?? null,
					notional,
					unrealizedPnl: pos.unrealizedPnl,
					realizedPnl: pos.realizedPnl,
					liquidationPrice: pos.liquidationPrice ?? null,
					confidence: pos.confidence ?? null,
					exitPlan: pos.exitPlan ?? null,
					lastDecisionAt: pos.lastDecisionAt ?? null,
					decisionStatus: pos.decisionStatus ?? null,
				};
			});

			const totalUnrealizedPnl = positions.reduce((sum, position) => {
				const pnl = requireFiniteNumber(
					position.unrealizedPnl,
					`model:${model.id}:${position.symbol}.unrealizedPnl`,
				);
				return sum + pnl;
			}, 0);

			return {
				modelId: model.id,
				modelName: model.name,
				modelLogo: model.modelLogo,
				modelVariant: model.variant,
				positions,
				totalUnrealizedPnl,
			};
		}),
	);

	return results;
}
