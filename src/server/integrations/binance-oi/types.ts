/**
 * Binance Open Interest Integration Types
 *
 * Uses Binance Futures API (free, no auth required):
 * - GET /futures/data/openInterestHist — historical OI with % change computation
 */

/** Raw response item from Binance /futures/data/openInterestHist */
export interface BinanceOiHistoryItem {
	symbol: string;
	sumOpenInterest: string; // OI in contracts
	sumOpenInterestValue: string; // OI in USD
	timestamp: number;
}

/** Parsed OI data for a single asset */
export interface OpenInterestData {
	/** Canonical symbol (e.g. "BTC") */
	symbol: string;
	/** Current open interest value (contracts) */
	openInterest: number;
	/** Current open interest value in USD */
	openInterestValueUsd: number;
	/** Percentage change over the lookback window (e.g. 24h) */
	changePercent: number;
	/** Timestamp of the latest data point */
	timestamp: number;
}

/** Map of canonical symbol → OI data */
export type OpenInterestMap = Map<string, OpenInterestData>;

/**
 * Map canonical symbols to Binance futures symbols.
 * Binance uses "BTCUSDT" format for USDT-margined futures.
 */
export function toBinanceFuturesSymbol(canonical: string): string {
	return `${canonical.toUpperCase()}USDT`;
}
