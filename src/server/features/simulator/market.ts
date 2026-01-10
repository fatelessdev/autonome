import type {
	MarketMetadata,
	OrderBookLevel,
	OrderBookSnapshot,
} from "@/server/features/simulator/types";
import { BASE_URL } from "@/env";
import axios from "axios";

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

	updateFromPrice(price: number): OrderBookSnapshot {
		// Create synthetic order book levels from price
		const spread = price * 0.0001; // 0.01% spread
		const bestBid = price - spread / 2;
		const bestAsk = price + spread / 2;

		// Provide deep liquidity for simulation - allow up to ~$100M notional
		// This prevents partial fills due to insufficient order book depth
		const depthQuantity = 100_000_000 / price;

		const bids: OrderBookLevel[] = [{ price: bestBid, quantity: depthQuantity }];
		const asks: OrderBookLevel[] = [{ price: bestAsk, quantity: depthQuantity }];

		this.snapshot = {
			symbol: this.metadata.symbol,
			bids,
			asks,
			midPrice: price,
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

	constructor(
		private readonly metadata: MarketMetadata,
		_orderApi: any, // Keep for backwards compatibility but unused
	) {
		this.orderBook = new OrderBook(metadata);
	}

	async refresh(): Promise<OrderBookSnapshot> {
		try {
			// Use /api/v1/orderBooks endpoint with proper headers
			const response = await axios.get(`${BASE_URL}/api/v1/orderBooks`, {
				headers: {
					'accept': 'application/json',
				},
			});

			const orderBooks = response.data?.order_books ?? [];
			const marketData = orderBooks.find(
				(ob: any) => ob.market_id === this.metadata.marketId
			);

			if (marketData?.last_trade_price) {
				return this.orderBook.updateFromPrice(marketData.last_trade_price);
			}

			// Fallback: use candles endpoint
			const now = Date.now();
			const candlesResponse = await axios.get(`${BASE_URL}/api/v1/candles`, {
				headers: {
					'accept': 'application/json',
				},
				params: {
					market_id: this.metadata.marketId,
					resolution: '1m',
					start_timestamp: now - 60000,
					end_timestamp: now,
					count_back: 1,
				},
			});

			const candles = candlesResponse.data?.c ?? [];
			if (candles.length > 0) {
				const latestPrice = candles[candles.length - 1].c; // close price
				return this.orderBook.updateFromPrice(latestPrice);
			}

			throw new Error(`No price data for market ${this.metadata.symbol}`);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new Error(`Market refresh failed for ${this.metadata.symbol}: ${message}`);
		}
	}

	getSnapshot(): OrderBookSnapshot {
		return this.orderBook.getSnapshot();
	}

	getMidPrice(): number {
		return this.orderBook.getMidPrice();
	}
}
