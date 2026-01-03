/**
 * Centralized Lighter API client instances.
 *
 * All server-side code should import from this module to avoid creating
 * duplicate API client instances which would cause unnecessary API calls
 * and potential rate limiting.
 */
import { BASE_URL } from "@/env";
import {
	FundingApi,
	IsomorphicFetchHttpLibrary,
	OrderApi,
	ServerConfiguration,
} from "@/lighter/generated/index";
import type { Candlestick, Candlesticks } from "@/lighter/generated/index";

// Shared configuration
const serverConfiguration = new ServerConfiguration(BASE_URL, {});
const httpLibrary = new IsomorphicFetchHttpLibrary();

/**
 * CandlestickApiCompat - Drop-in replacement for CandlestickApi
 * 
 * The SDK's CandlestickApi uses /api/v1/candlesticks which returns 403.
 * This compatibility layer uses the /api/v1/candles endpoint which works.
 * Same interface as the SDK class so no consuming code changes needed.
 * 
 * API Response format:
 * {
 *   "code": 200,
 *   "r": "5m",
 *   "c": [{ "t": timestamp, "o": open, "h": high, "l": low, "c": close, "v": volume, "V": quoteVolume, "i": openInterest }]
 * }
 */
export class CandlestickApiCompat {
	private baseUrl: string;

	constructor(baseUrl: string) {
		this.baseUrl = baseUrl.replace(/\/$/, ""); // Remove trailing slash
	}

	/**
	 * Fetch candlesticks - same signature as SDK's CandlestickApi.candlesticks()
	 */
	async candlesticks(
		marketId: number,
		resolution: "1m" | "5m" | "15m" | "1h" | "4h" | "1d",
		startTimestamp: number,
		endTimestamp: number,
		countBack: number,
		_setTimestampToEnd?: boolean,
	): Promise<Candlesticks> {
		const url = new URL(`${this.baseUrl}/api/v1/candles`);
		url.searchParams.set("market_id", marketId.toString());
		url.searchParams.set("resolution", resolution);
		url.searchParams.set("start_timestamp", Math.floor(startTimestamp).toString());
		url.searchParams.set("end_timestamp", Math.floor(endTimestamp).toString());
		url.searchParams.set("count_back", countBack.toString());

		try {
			const response = await fetch(url.toString(), {
				method: "GET",
				headers: { Accept: "application/json" },
			});

			if (!response.ok) {
				console.warn(
					`[CandlestickApiCompat] /candles returned ${response.status}, returning empty`,
				);
				return { code: response.status, resolution, candlesticks: [] };
			}

			const data = await response.json();
			
			// API returns { c: [...] } with abbreviated candlestick objects
			// Need to map to SDK's Candlestick format
			const rawCandles = data.c ?? data.candlesticks ?? data.candles ?? [];
			
			const candles: Candlestick[] = rawCandles.map((c: {
				t: number;
				o: number;
				h: number;
				l: number;
				c: number;
				v: number;
				V?: number;
				i?: number;
			}) => ({
				timestamp: c.t,
				open: c.o,
				high: c.h,
				low: c.l,
				close: c.c,
				volume: c.v,
				quoteVolume: c.V,
				openInterest: c.i,
			}));
			
			return { code: data.code ?? 200, resolution: data.r ?? resolution, candlesticks: candles };
		} catch (error) {
			console.error("[CandlestickApiCompat] Fetch failed:", error);
			return { code: 500, resolution, candlesticks: [] };
		}
	}
}

// Use our compatibility layer instead of the SDK's CandlestickApi
export const candlestickApi = new CandlestickApiCompat(BASE_URL);

export const fundingApi = new FundingApi({
	baseServer: serverConfiguration,
	httpApi: httpLibrary,
	middleware: [],
	authMethods: {},
});

export const orderApi = new OrderApi({
	baseServer: serverConfiguration,
	httpApi: httpLibrary,
	middleware: [],
	authMethods: {},
});

// Re-export types and utilities that may be needed
export { BASE_URL, serverConfiguration, httpLibrary };
