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

const BASIS_POINT = 1 / 10000;

function sampleLatency(ctx: MatchingContext): number {
	const { minMs, maxMs } = ctx.options.latency;
	if (maxMs <= minMs) return minMs;
	const roll = ctx.rng.next();
	return Math.round(minMs + (maxMs - minMs) * roll);
}

function sampleSlippage(ctx: MatchingContext): number {
	const bps = ctx.options.slippage.maxBasisPoints;
	if (bps <= 0) return 0;
	return ctx.rng.next() * bps;
}

function asTaker(ctx: MatchingContext): OrderExecution {
	const { order, book, options } = ctx;
	const levels = order.side === "buy" ? book.asks : book.bids;

	if (!levels || levels.length === 0) {
		return {
			fills: [],
			averagePrice: 0,
			totalQuantity: 0,
			totalFees: 0,
			status: "rejected",
			reason: "no liquidity available",
		};
	}

	let remaining = order.quantity;
	const fills: FillDetail[] = [];
	let totalNotional = 0;
	let totalFees = 0;

	for (const level of levels) {
		if (remaining <= 0) break;
		const executable = Math.min(remaining, level.quantity);
		if (executable <= 0) continue;

		const slippageBps = sampleSlippage(ctx);
		const slippageFactor = slippageBps * BASIS_POINT;
		const priceAdjustment =
			order.side === "buy" ? 1 + slippageFactor : 1 - slippageFactor;
		const price = level.price * priceAdjustment;
		const latencyMs = sampleLatency(ctx);
		const feeRate = options.fees.takerBps * BASIS_POINT;
		const fee = executable * price * feeRate;

		fills.push({
			quantity: executable,
			price,
			maker: false,
			fee,
			slippageBps,
			latencyMs,
		});
		remaining -= executable;
		totalNotional += price * executable;
		totalFees += fee;
	}

	if (fills.length === 0) {
		return {
			fills,
			averagePrice: 0,
			totalQuantity: 0,
			totalFees: 0,
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
		totalFees,
		status,
		reason: status === "partial" ? "insufficient book depth" : undefined,
	};
}

function asMaker(ctx: MatchingContext): OrderExecution {
	const { order, options } = ctx;
	const price = order.limitPrice ?? ctx.book.midPrice;
	const slippageBps = 0;
	const latencyMs = sampleLatency(ctx);
	const feeRate = options.fees.makerBps * BASIS_POINT;
	const fee = order.quantity * price * feeRate;

	const fill: FillDetail = {
		quantity: order.quantity,
		price,
		maker: true,
		fee,
		slippageBps,
		latencyMs,
	};

	return {
		fills: [fill],
		averagePrice: price,
		totalQuantity: order.quantity,
		totalFees: fee,
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
			totalFees: 0,
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
		totalFees: 0,
		status: "rejected",
		reason: "invalid order parameters",
	};
}
