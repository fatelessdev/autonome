/**
 * Centralized Lighter API client instances.
 *
 * All server-side code should import from this module to avoid creating
 * duplicate API client instances which would cause unnecessary API calls
 * and potential rate limiting.
 *
 * Uses @reservoir0x/lighter-ts-sdk for SignerClient and other APIs.
 * Uses REST API directly for candlesticks (/api/v1/candles endpoint).
 */
import { BASE_URL } from "@/env";
import {
	ApiClient,
	FundingApi,
	OrderApi,
	AccountApi,
} from "@reservoir0x/lighter-ts-sdk";
import axios from "axios";
import type { Candlestick } from "@/server/features/trading/indicators";

// Default timeout for API calls (30 seconds)
const API_TIMEOUT_MS = 30_000;

// Singleton API client
const apiClient = new ApiClient({ host: BASE_URL });

// Singleton API instances - all server code should use these
export const fundingApi = new FundingApi(apiClient);
export const orderApi = new OrderApi(apiClient);
export const accountApi = new AccountApi(apiClient);

/**
 * Fetch candlesticks using the REST API /api/v1/candles endpoint.
 * Requires 'accept: application/json' header.
 * Response format: { code: 200, r: resolution, c: [{ t, o, h, l, c, v, V, i }] }
 */
export async function fetchCandlesticksRest(params: {
	market_id: number;
	resolution: string;
	start_timestamp?: number;
	end_timestamp?: number;
	count_back?: number;
}): Promise<Candlestick[]> {
	try {
		const now = Date.now();
		const response = await axios.get(`${BASE_URL}/api/v1/candles`, {
			headers: {
				'accept': 'application/json',
			},
			params: {
				market_id: params.market_id,
				resolution: params.resolution,
				start_timestamp: params.start_timestamp ?? (now - 24 * 60 * 60 * 1000),
				end_timestamp: params.end_timestamp ?? now,
				count_back: params.count_back,
			},
			timeout: API_TIMEOUT_MS,
		});

		// API response format: { code, r, c: [...candles] }
		// Each candle: { t: timestamp, o: open, h: high, l: low, c: close, v: volume, V: quoteVolume }
		const candles = response.data?.c ?? [];
		
		// Convert to our internal Candlestick format
		return candles.map((c: any) => ({
			timestamp: c.t,
			open: c.o,
			high: c.h,
			low: c.l,
			close: c.c,
			volume: c.v ?? 0,
			volume0: c.v,  // base volume
			volume1: c.V,  // quote volume
		}));
	} catch (error) {
		console.error('[fetchCandlesticksRest] Failed to fetch candles:', error);
		return [];
	}
}

// Re-export types and utilities that may be needed
export { apiClient, BASE_URL };
