/**
 * Trades query — fetches closed orders with model metadata.
 */

import { queryOptions } from "@tanstack/react-query";
import { and, desc, eq, inArray, isNull, ne, or } from "drizzle-orm";
import { CACHE_TIMING } from "@/core/shared/cache/cacheConfig";
import {
	formatDuration,
	formatIstTimestamp,
} from "@/core/shared/formatting/dateFormat";
import {
	isValidVariantId,
	VARIANT_IDS,
	type VariantId,
} from "@/core/shared/variants";
import { db } from "@/db";
import { models, orders } from "@/db/schema";
import { parseRequiredFiniteNumber } from "./cryptoPrices";

type TradeRecord = {
	id: string;
	modelId: string;
	modelName: string;
	modelRouterName: string | null;
	modelVariant: string;
	symbol: string;
	side: string;
	quantity: number | null;
	entryPrice: number | null;
	exitPrice: number | null;
	netPnl: number | null;
	openedAt: string | null;
	closedAt: string;
	holdingTime: string | null;
	timestamp: string;
};

export type FetchTradesOptions = { variant?: VariantId; limit?: number };

export const tradesQuery = (options?: FetchTradesOptions) =>
	queryOptions({
		queryKey: ["trades", options?.variant ?? "all", options?.limit ?? 100],
		queryFn: () => fetchTrades(options),
		staleTime: CACHE_TIMING.STANDARD,
		gcTime: 5 * CACHE_TIMING.SLOW,
	});

export async function fetchTrades(
	options?: FetchTradesOptions,
): Promise<TradeRecord[]> {
	const { variant, limit = 100 } = options ?? {};
	const normalizedVariant = isValidVariantId(variant) ? variant : undefined;

	const variants = normalizedVariant ? [normalizedVariant] : VARIANT_IDS;
	const LIMIT_PER_VARIANT = Math.ceil(limit / variants.length);

	const variantQueries = variants.map((v) => {
		const variantModelIds = db
			.select({ id: models.id })
			.from(models)
			.where(eq(models.variant, v));

		return db.query.orders.findMany({
			where: and(
				eq(orders.status, "CLOSED"),
				or(isNull(orders.closeTrigger), ne(orders.closeTrigger, "adjustment")),
				inArray(orders.modelId, variantModelIds),
			),
			with: {
				model: {
					columns: { name: true, openRouterModelName: true, variant: true },
				},
			},
			orderBy: desc(orders.closedAt),
			limit: LIMIT_PER_VARIANT,
		});
	});

	const variantResults = await Promise.all(variantQueries);
	const closedOrders = variantResults.flat().sort((a, b) => {
		if (!a.closedAt) {
			throw new Error(`Closed order ${a.id} is missing closedAt`);
		}
		if (!b.closedAt) {
			throw new Error(`Closed order ${b.id} is missing closedAt`);
		}
		return b.closedAt.getTime() - a.closedAt.getTime();
	});

	return closedOrders.map((order) => {
		if (!order.model) {
			throw new Error(
				`Closed order ${order.id} is missing required model relation`,
			);
		}
		if (!order.closedAt) {
			throw new Error(`Closed order ${order.id} is missing closedAt`);
		}
		if (!isValidVariantId(order.model.variant)) {
			throw new Error(
				`Closed order ${order.id} has invalid model variant: ${order.model.variant}`,
			);
		}

		const openedAt = order.openedAt;
		const closedAt = order.closedAt;
		const holdingTime = formatDuration(openedAt, closedAt);
		const quantity = parseRequiredFiniteNumber(
			order.quantity,
			"quantity",
			`order:${order.id}`,
		);
		const entryPrice = parseRequiredFiniteNumber(
			order.entryPrice,
			"entryPrice",
			`order:${order.id}`,
		);
		const exitPrice = parseRequiredFiniteNumber(
			order.exitPrice,
			"exitPrice",
			`order:${order.id}`,
		);

		return {
			id: order.id,
			modelId: order.modelId,
			modelName: order.model.name,
			modelRouterName: order.model.openRouterModelName ?? null,
			modelVariant: order.model.variant,
			symbol: order.symbol,
			side: order.side,
			quantity,
			entryPrice,
			exitPrice,
			netPnl: parseRequiredFiniteNumber(
				order.realizedPnl,
				"realizedPnl",
				`order:${order.id}`,
			),
			openedAt: openedAt.toISOString(),
			closedAt: closedAt.toISOString(),
			holdingTime,
			timestamp: formatIstTimestamp(closedAt),
		};
	});
}
