import { and, desc, eq, inArray, isNull, ne, or } from "drizzle-orm";
import { db } from "@/db";
import {
	orders,
	OrderStatus,
	type Order,
} from "@/db/schema";
import { toCanonical } from "@/shared/markets/marketMetadata";

// ==========================================
// Types
// ==========================================

export type CreateOrderParams = {
	modelId: string;
	symbol: string;
	side: "LONG" | "SHORT";
	quantity: string;
	entryPrice: string;
	exitPlan?: {
		stop: number | null;
		target: number | null;
		invalidation: string | null;
		invalidationPrice: number | null;
		confidence: number | null;
		timeExit: string | null;
		cooldownUntil: string | null;
	} | null;
};

export type CloseOrderParams = {
	orderId: string;
	exitPrice: string;
	realizedPnl: string;
	closeTrigger?: string | null;
};

export type ScaleOrderParams = {
	orderId: string;
	additionalQuantity: string;
	newEntryPrice: string;
	newAvgEntryPrice: string;
	exitPlan?: {
		stop: number | null;
		target: number | null;
		invalidation: string | null;
		invalidationPrice: number | null;
		confidence: number | null;
		timeExit: string | null;
		cooldownUntil: string | null;
	} | null;
};

export type UpdateSlTpOrdersParams = {
	orderId: string;
	alpacaOrderId?: string | null;
};

export type OrderWithModel = Order & {
	model: {
		name: string;
		openRouterModelName: string | null;
	} | null;
};

// ==========================================
// Repository Functions
// ==========================================

/**
 * Create a new order (position)
 */
export async function createOrder(params: CreateOrderParams): Promise<Order> {
	const id = crypto.randomUUID();

	const [order] = await db
		.insert(orders)
		.values({
			id,
			modelId: params.modelId,
			symbol: params.symbol.toUpperCase(),
			side: params.side,
			quantity: params.quantity,
			entryPrice: params.entryPrice,
			exitPlan: params.exitPlan ?? null,
			status: OrderStatus.OPEN,
		})
		.returning();

	return order;
}

/**
 * Close an order (mark position as closed)
 */
export async function closeOrder(params: CloseOrderParams): Promise<Order> {
	const existing = await db.query.orders.findFirst({
		where: eq(orders.id, params.orderId),
	});

	if (!existing) {
		throw new Error(`Order ${params.orderId} not found`);
	}

	const [updated] = await db
		.update(orders)
		.set({
			status: OrderStatus.CLOSED,
			exitPrice: params.exitPrice,
			realizedPnl: params.realizedPnl,
			closeTrigger: params.closeTrigger ?? null,
			closedAt: new Date(),
			updatedAt: new Date(),
		})
		.where(eq(orders.id, params.orderId))
		.returning();

	return updated;
}

/**
 * Scale into an existing position (aggregate quantity, recalculate weighted avg entry)
 * Uses formula: newAvgEntry = (prevNotional + newNotional) / totalQty
 */
export async function scaleIntoOrder(params: ScaleOrderParams): Promise<Order> {
	const updateData: {
		quantity: string;
		entryPrice: string;
		updatedAt: Date;
		exitPlan?: {
			stop: number | null;
			target: number | null;
			invalidation: string | null;
			invalidationPrice: number | null;
			confidence: number | null;
			timeExit: string | null;
			cooldownUntil: string | null;
		} | null;
	} = {
		quantity: (
			parseFloat(params.additionalQuantity) +
			parseFloat(
				(
					await db.query.orders.findFirst({
						where: eq(orders.id, params.orderId),
						columns: { quantity: true },
					})
				)?.quantity ?? "0",
			)
		).toString(),
		entryPrice: params.newAvgEntryPrice,
		updatedAt: new Date(),
	};

	if (params.exitPlan !== undefined) {
		updateData.exitPlan = params.exitPlan;
	}

	const [updated] = await db
		.update(orders)
		.set(updateData)
		.where(eq(orders.id, params.orderId))
		.returning();

	return updated;
}

/**
 * Get all open orders (active positions) for a model
 */
export async function getOpenOrdersByModel(
	modelId: string,
): Promise<Order[]> {
	return db.query.orders.findMany({
		where: and(eq(orders.modelId, modelId), eq(orders.status, OrderStatus.OPEN)),
		orderBy: desc(orders.openedAt),
	});
}

/**
 * Get all open orders across all models
 */
export async function getAllOpenOrders(): Promise<OrderWithModel[]> {
	return db.query.orders.findMany({
		where: eq(orders.status, OrderStatus.OPEN),
		with: {
			model: {
				columns: {
					name: true,
					openRouterModelName: true,
				},
			},
		},
		orderBy: desc(orders.openedAt),
	});
}

/**
 * Get open order for a specific model and symbol
 * (A model can only have one open position per symbol)
 */
export async function getOpenOrderBySymbol(
	modelId: string,
	symbol: string,
): Promise<Order | undefined> {
	const canonical = toCanonical(symbol).toUpperCase();
	const symbolCandidates = [
		canonical,
		`${canonical}USD`,
		`${canonical}/USD`,
		`${canonical}-USD`,
		`${canonical}USDT`,
		`${canonical}/USDT`,
		`${canonical}-USDT`,
	].filter((value, index, array) => array.indexOf(value) === index);

	return db.query.orders.findFirst({
		where: and(
			eq(orders.modelId, modelId),
			inArray(orders.symbol, symbolCandidates),
			eq(orders.status, OrderStatus.OPEN),
		),
		orderBy: desc(orders.openedAt),
	});
}

/**
 * Get all closed orders (completed trades) for a model
 */
export async function getClosedOrdersByModel(
	modelId: string,
	limit = 100,
): Promise<Order[]> {
	return db.query.orders.findMany({
		where: and(
			eq(orders.modelId, modelId),
			eq(orders.status, OrderStatus.CLOSED),
			or(isNull(orders.closeTrigger), ne(orders.closeTrigger, "adjustment")),
		),
		orderBy: desc(orders.closedAt),
		limit,
	});
}

/**
 * Get all closed orders across all models
 */
export async function getAllClosedOrders(
	limit = 100,
): Promise<OrderWithModel[]> {
	return db.query.orders.findMany({
		where: eq(orders.status, OrderStatus.CLOSED),
		with: {
			model: {
				columns: {
					name: true,
					openRouterModelName: true,
				},
			},
		},
		orderBy: desc(orders.closedAt),
		limit,
	});
}

/**
 * Get order by ID
 */
export async function getOrderById(orderId: string): Promise<Order | undefined> {
	return db.query.orders.findFirst({
		where: eq(orders.id, orderId),
	});
}

/**
 * Calculate total realized P&L for a model from closed orders
 */
export async function getTotalRealizedPnl(modelId: string): Promise<number> {
	const closedOrders = await db.query.orders.findMany({
		where: and(
			eq(orders.modelId, modelId),
			eq(orders.status, OrderStatus.CLOSED),
		),
		columns: {
			realizedPnl: true,
		},
	});

	return closedOrders.reduce((sum, order) => {
		return sum + (parseFloat(order.realizedPnl ?? "0") || 0);
	}, 0);
}

/**
 * Bulk close orders by IDs
 */
export async function closeOrdersByIds(
	orderIds: string[],
	exitPrices: Map<string, { price: string; pnl: string; trigger?: string }>,
): Promise<Order[]> {
	const results: Order[] = [];

	for (const orderId of orderIds) {
		const priceData = exitPrices.get(orderId);
		if (!priceData) continue;

		const closed = await closeOrder({
			orderId,
			exitPrice: priceData.price,
			realizedPnl: priceData.pnl,
			closeTrigger: priceData.trigger as "STOP" | "TARGET" | undefined,
		});
		results.push(closed);
	}

	return results;
}

// ==========================================
// Alpaca Order ID Management
// ==========================================

/**
 * Update the Alpaca order ID for a position.
 * Used when placing orders via Alpaca API.
 */
export async function updateAlpacaOrderId(
	params: UpdateSlTpOrdersParams,
): Promise<Order> {
	const updateData: Record<string, unknown> = {
		updatedAt: new Date(),
	};

	if (params.alpacaOrderId !== undefined) {
		updateData.alpacaOrderId = params.alpacaOrderId;
	}

	const [updated] = await db
		.update(orders)
		.set(updateData)
		.where(eq(orders.id, params.orderId))
		.returning();

	return updated;
}

/**
 * Update the close trigger on a closed order (e.g., marking as "adjustment")
 */
export async function updateOrderCloseTrigger(
	orderId: string,
	closeTrigger: string,
): Promise<void> {
	await db
		.update(orders)
		.set({ closeTrigger, updatedAt: new Date() })
		.where(eq(orders.id, orderId));
}
