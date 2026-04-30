/**
 * Binance Open Interest Integration
 *
 * Exports the client and types for fetching open interest data
 * from Binance Futures API (free, no auth required).
 */

export { fetchAllOpenInterest } from "./client";
export type {
	BinanceOiHistoryItem,
	OpenInterestData,
	OpenInterestMap,
} from "./types";
export { toBinanceFuturesSymbol } from "./types";
