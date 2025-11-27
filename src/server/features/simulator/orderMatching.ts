import type {
	ExchangeSimulatorOptions,
	FillDetail,
	OrderBookSnapshot,
	OrderExecution,
	OrderMatchingInput,
} from "@/server/features/simulator/types";

export interface RandomSource {
	next(): number;
}

interface MatchingContext {
	book: OrderBookSnapshot;
	order: OrderMatchingInput;
	options: ExchangeSimulatorOptions;
	rng: RandomSource;
}


function asTaker(ctx: MatchingContext): OrderExecution {
	const { order, book } = ctx;
	const levels = order.side === "buy" ? book.asks : book.bids;

	if (!levels || levels.length === 0) {
		return {
			fills: [],
			averagePrice: 0,
			totalQuantity: 0,
			status: "rejected",
			reason: "no liquidity available",
		};
	}

	let remaining = order.quantity;
	const fills: FillDetail[] = [];
	let totalNotional = 0;

	for (const level of levels) {
		if (remaining <= 0) break;
		const executable = Math.min(remaining, level.quantity);
		if (executable <= 0) continue;

		const price = level.price;

		fills.push({
			quantity: executable,
			price,
		});
		remaining -= executable;
		totalNotional += price * executable;
	}

	if (fills.length === 0) {
		return {
			fills,
			averagePrice: 0,
			totalQuantity: 0,
			status: "rejected",
			reason: "insufficient liquidity",
		};
	}

	const totalQuantity = fills.reduce((sum, fill) => sum + fill.quantity, 0);
	const averagePrice = totalNotional / totalQuantity;
	const status = remaining > 0 ? "partial" : "filled";

	return {
		fills,
		averagePrice,
		totalQuantity,
		status,
		reason: status === "partial" ? "insufficient book depth" : undefined,
	};
}

function asMaker(ctx: MatchingContext): OrderExecution {
	const { order } = ctx;
	const price = order.limitPrice ?? ctx.book.midPrice;

	const fill: FillDetail = {
		quantity: order.quantity,
		price,
	};

	return {
		fills: [fill],
		averagePrice: price,
		totalQuantity: order.quantity,
		status: "filled",
	};
}

export function matchOrder(
	book: OrderBookSnapshot,
	order: OrderMatchingInput,
	options: ExchangeSimulatorOptions,
	rng: RandomSource,
): OrderExecution {
	const ctx: MatchingContext = { book, order, options, rng };

	if (order.type === "market") {
		return asTaker(ctx);
	}

	if (order.type === "limit" && typeof order.limitPrice !== "number") {
		return {
			fills: [],
			averagePrice: 0,
			totalQuantity: 0,
			status: "rejected",
			reason: "limit order missing limitPrice",
		};
	}

	const bestOpposite =
		order.side === "buy" ? book.asks[0]?.price : book.bids[0]?.price;

	const shouldTake =
		typeof order.limitPrice === "number" &&
		bestOpposite !== undefined &&
		((order.side === "buy" && order.limitPrice >= bestOpposite) ||
			(order.side === "sell" && order.limitPrice <= bestOpposite));

	if (shouldTake) {
		return asTaker(ctx);
	}

	if (order.type === "limit" && typeof order.limitPrice === "number") {
		return asMaker(ctx);
	}

	return {
		fills: [],
		averagePrice: 0,
		totalQuantity: 0,
		status: "rejected",
		reason: "invalid order parameters",
	};
}
