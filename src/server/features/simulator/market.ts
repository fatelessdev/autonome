import type {
	MarketMetadata,
	OrderBookLevel,
	OrderBookSnapshot,
} from "@/server/features/simulator/types";
import type { OrderApi } from "@reservoir0x/lighter-ts-sdk";
import type { Order } from "@reservoir0x/lighter-ts-sdk/dist/api/order-api";
import { BASE_URL } from "@/env";

interface OrderBookOrdersResponse {
	code: number;
	total_asks: number;
	total_bids: number;
	asks: Order[];
	bids: Order[];
}

class OrderBook {
	private snapshot: OrderBookSnapshot;

	constructor(private readonly metadata: MarketMetadata) {
		this.snapshot = {
			symbol: metadata.symbol,
			bids: [],
			asks: [],
			midPrice: 0,
			spread: 0,
			timestamp: Date.now(),
		};
	}

	private convertLevel(order: Order): OrderBookLevel {
		const quantity = Number(order.remaining_base_amount ?? order.size ?? 0);
		const price = Number(order.price ?? 0);
		return { price, quantity };
	}

	update(asks: Order[], bids: Order[]): OrderBookSnapshot {
		const bidLevels = bids.map((order) => this.convertLevel(order));
		const askLevels = asks.map((order) => this.convertLevel(order));

		const bestBid = bidLevels[0]?.price;
		const bestAsk = askLevels[0]?.price;
		const midPrice =
			bestBid && bestAsk
				? (bestBid + bestAsk) / 2
				: (bestBid ?? bestAsk ?? this.snapshot.midPrice);
		const spread = bestBid && bestAsk ? bestAsk - bestBid : 0;

		this.snapshot = {
			symbol: this.metadata.symbol,
			bids: bidLevels,
			asks: askLevels,
			midPrice,
			spread,
			timestamp: Date.now(),
		};

		return this.snapshot;
	}

	getSnapshot(): OrderBookSnapshot {
		return this.snapshot;
	}

	getMidPrice(): number {
		return this.snapshot.midPrice;
	}
}

export class MarketState {
	private readonly orderBook: OrderBook;
	private readonly baseUrl: string;

	constructor(
		private readonly metadata: MarketMetadata,
		private readonly orderApi: OrderApi,
		private readonly depth = 50,
	) {
		this.orderBook = new OrderBook(metadata);
		// Extract base URL from the orderApi's client
		// Default to mainnet if not available
		this.baseUrl = "https://mainnet.zklighter.elliot.ai";
	}

	async refresh(): Promise<OrderBookSnapshot> {
		// Work around SDK bug: SDK uses 'depth' but API expects 'limit'
		// See: https://github.com/reservoir0x/lighter-ts-sdk/issues/11
		const url = `${this.baseUrl}/api/v1/orderBookOrders?market_id=${this.metadata.marketId}&limit=${this.depth}`;
		
		const response = await fetch(url);
		if (!response.ok) {
			throw new Error(`Failed to fetch order book: ${response.status}`);
		}
		
		const data = await response.json() as OrderBookOrdersResponse;
		
		if (data.code !== 200) {
			throw new Error(`API error: ${data.code}`);
		}

		return this.orderBook.update(data.asks ?? [], data.bids ?? []);
	}

	getSnapshot(): OrderBookSnapshot {
		return this.orderBook.getSnapshot();
	}

	getMidPrice(): number {
		return this.orderBook.getMidPrice();
	}
}
