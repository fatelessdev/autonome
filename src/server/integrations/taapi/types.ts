/**
 * TAAPI Integration Types
 * TypeScript types for TAAPI technical analysis API
 */

export interface TaapiIndicatorConfig {
	id: string;
	indicator: string;
	period?: number;
	results?: number;
	backtrack?: number;
}

// Single construct for one symbol
export interface TaapiConstruct {
	exchange: "binance";
	symbol: string; // e.g., "BTC/USDT"
	interval: string; // e.g., "1h", "4h"
	indicators: TaapiIndicatorConfig[];
}

// Payload supports both single construct and array of constructs
export interface TaapiBulkPayload {
	secret: string;
	construct: TaapiConstruct | TaapiConstruct[];
}

// Free plan symbols (TAAPI limitation)
export const TAAPI_FREE_PLAN_SYMBOLS = ["BTC", "ETH"] as const;
export type TaapiFreeSymbol = (typeof TAAPI_FREE_PLAN_SYMBOLS)[number];

export interface TaapiBulkResponseItem {
	id: string;
	result: unknown;
	errors?: string[];
}

export interface TaapiBulkResponse {
	data: TaapiBulkResponseItem[];
}

// Specific indicator result types
export interface BBandsResult {
	valueUpperBand: number;
	valueMiddleBand: number;
	valueLowerBand: number;
}

export interface ADXResult {
	value: number; // ADX value (single value, not adx/pdi/mdi)
}

export interface SupertrendResult {
	value: number;
	valueAdvice: "long" | "short";
}

export interface StochRSIResult {
	valueFastK: number;
	valueFastD: number;
}

export interface IchimokuResult {
	conversion: number;
	base: number;
	spanA: number;
	spanB: number;
	lagging: number;
}

export interface MACDResult {
	valueMACD: number;
	valueMACDSignal: number;
	valueMACDHist: number;
}

export interface KeltnerResult {
	valueUpperBand: number;
	valueMiddleBand: number;
	valueLowerBand: number;
}

export interface DonchianResult {
	valueHigh: number;
	valueMid: number;
	valueLow: number;
}

export interface VWAPResult {
	value: number;
}

export interface OBVResult {
	value: number;
}

export interface CCIResult {
	value: number;
}

export interface WillRResult {
	value: number;
}

export interface MFIResult {
	value: number;
}

export interface SARResult {
	value: number;
}

export interface StochResult {
	valueK: number;
	valueD: number;
}

// Pre-fetch result structure (for BBands, ADX, Supertrend, Ichimoku, VWAP)
export interface TaapiPreFetchResult {
	bbands: BBandsResult | null;
	adx: ADXResult | null;
	supertrend: SupertrendResult | null;
	ichimoku: IchimokuResult | null;
	vwap: VWAPResult | null;
	fetchedAt: number;
}

// Available indicators for on-demand fetching
export const AVAILABLE_TAAPI_INDICATORS = [
	"ema",
	"sma",
	"rsi",
	"macd",
	"bbands",
	"adx",
	"supertrend",
	"stochrsi",
	"ichimoku",
	"vwap",
	"obv",
	"cci",
	"willr",
	"mfi",
	"roc",
	"mom",
	"sar",
	"stoch",
	"keltner",
	"donchian",
	"atr",
] as const;

export type TaapiIndicatorName = (typeof AVAILABLE_TAAPI_INDICATORS)[number];
