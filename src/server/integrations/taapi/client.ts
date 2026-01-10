/**
 * TAAPI Client
 * Client for fetching technical indicators from TAAPI.io
 * Uses bulk endpoint for efficient fetching + retry logic
 */

import { TAAPI_API_KEY } from "@/env";
import { taapiCache } from "./cache";
import type {
	TaapiBulkPayload,
	TaapiBulkResponse,
	TaapiIndicatorConfig,
	TaapiPreFetchResult,
	BBandsResult,
	ADXResult,
	SupertrendResult,
	IchimokuResult,
	VWAPResult,
} from "./types";
import { TAAPI_FREE_PLAN_SYMBOLS } from "./types";

const BULK_URL = "https://api.taapi.io/bulk";

// Get API key from environment
const getTaapiApiKey = (): string => {
	if (!TAAPI_API_KEY) {
		console.warn("[TAAPI] TAAPI_API_KEY not set, API calls will fail");
		return "";
	}
	return TAAPI_API_KEY;
};

export class TaapiClient {
	/**
	 * POST request with exponential backoff retry logic
	 * Free plan: 1 request per 15 seconds, so we use longer backoff
	 */
	private async postWithRetry(
		payload: TaapiBulkPayload,
		retries = 3,
		backoffMs = 15000, // 15 seconds for free plan
	): Promise<TaapiBulkResponse> {
		for (let attempt = 0; attempt < retries; attempt++) {
			try {
				const response = await fetch(BULK_URL, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(payload),
				});

				if (response.status === 429) {
					if (attempt < retries - 1) {
						const wait = backoffMs * (attempt + 1); // Linear backoff for rate limits
						console.warn(
							`[TAAPI] Rate limit (429), retrying in ${Math.round(wait / 1000)}s (attempt ${attempt + 1}/${retries})`,
						);
						await new Promise((r) => setTimeout(r, wait));
						continue;
					}
					throw new Error("TAAPI rate limit exceeded after retries");
				}

				if (!response.ok) {
					const text = await response.text();
					throw new Error(
						`TAAPI error: ${response.status} ${response.statusText} - ${text}`,
					);
				}

				return (await response.json()) as TaapiBulkResponse;
			} catch (error) {
				const isTimeout =
					error instanceof Error && error.message.includes("timeout");
				const isNetworkError =
					error instanceof Error &&
					(error.message.includes("fetch") ||
						error.message.includes("network"));

				if ((isTimeout || isNetworkError) && attempt < retries - 1) {
					const wait = backoffMs * (attempt + 1);
					console.warn(`[TAAPI] Network error, retrying in ${Math.round(wait / 1000)}s`);
					await new Promise((r) => setTimeout(r, wait));
					continue;
				}
				throw error;
			}
		}
		throw new Error("TAAPI max retries exceeded");
	}

	/**
	 * Fetch multiple indicators in a single bulk request.
	 * Results are cached by asset+timeframe+indicatorSet.
	 */
	async fetchBulkIndicators(
		symbol: string, // e.g., "BTC/USDT"
		interval: string, // e.g., "1h", "4h"
		indicators: TaapiIndicatorConfig[],
		cacheKey?: string, // Optional cache key for this specific combo
	): Promise<Record<string, unknown>> {
		const asset = symbol.split("/")[0];

		// Check cache first
		const cached = taapiCache.get<Record<string, unknown>>(
			asset,
			interval,
			cacheKey,
		);
		if (cached) {
			console.log(
				`[TAAPI] Cache hit for ${asset}:${interval}:${cacheKey ?? "default"}`,
			);
			return cached;
		}

		const apiKey = getTaapiApiKey();
		if (!apiKey) {
			console.error("[TAAPI] No API key configured");
			return {};
		}

		const payload: TaapiBulkPayload = {
			secret: apiKey,
			construct: {
				exchange: "binancefutures",
				symbol,
				interval,
				indicators,
			},
		};

		console.log(
			`[TAAPI] Fetching ${indicators.length} indicators for ${symbol} @ ${interval}`,
		);
		const response = await this.postWithRetry(payload);

		// Parse results by ID
		const results: Record<string, unknown> = {};
		for (const item of response.data) {
			if (item.errors && item.errors.length > 0) {
				console.warn(`[TAAPI] Error for ${item.id}:`, item.errors);
				results[item.id] = null;
			} else {
				results[item.id] = item.result;
			}
		}

		// Cache the results
		taapiCache.set(asset, interval, results, cacheKey);

		return results;
	}

	/**
	 * Pre-fetch the standard supplementary indicators (BBands, ADX, Supertrend, Ichimoku, VWAP).
	 * Called once per asset before AI runs. EMA50 is now calculated locally.
	 */
	async preFetchSupplementaryIndicators(
		asset: string,
		interval = "1h",
	): Promise<TaapiPreFetchResult> {
		const symbol = `${asset.toUpperCase()}/USDT`;

		// Check cache first
		const cached = taapiCache.get<TaapiPreFetchResult>(
			asset,
			interval,
			"prefetch",
		);
		if (cached) {
			console.log(`[TAAPI] Pre-fetch cache hit for ${asset}:${interval}`);
			return cached;
		}

		// These indicators are complex to calculate locally, so we fetch from TAAPI
		const indicators: TaapiIndicatorConfig[] = [
			{ id: "bbands", indicator: "bbands", period: 20 }, // Standard 20-period BBands
			{ id: "adx", indicator: "adx", period: 14 }, // 14-period ADX with +DI/-DI
			{ id: "supertrend", indicator: "supertrend", period: 10 }, // Supertrend with signal
			{ id: "ichimoku", indicator: "ichimoku" }, // Ichimoku Cloud (default periods: 9, 26, 52)
			{ id: "vwap", indicator: "vwap" }, // Volume Weighted Average Price
		];

		try {
			const results = await this.fetchBulkIndicators(
				symbol,
				interval,
				indicators,
				"prefetch",
			);

			const prefetchResult: TaapiPreFetchResult = {
				bbands: results.bbands as BBandsResult | null,
				adx: results.adx as ADXResult | null,
				supertrend: results.supertrend as SupertrendResult | null,
				ichimoku: results.ichimoku as IchimokuResult | null,
				vwap: results.vwap as VWAPResult | null,
				fetchedAt: Date.now(),
			};

			taapiCache.set(asset, interval, prefetchResult, "prefetch");
			return prefetchResult;
		} catch (error) {
			console.error(`[TAAPI] Pre-fetch failed for ${asset}:`, error);
			return {
				bbands: null,
				adx: null,
				supertrend: null,
				ichimoku: null,
				vwap: null,
				fetchedAt: Date.now(),
			};
		}
	}

	/**
	 * Check if TAAPI is configured and available
	 */
	isConfigured(): boolean {
		return !!getTaapiApiKey();
	}

	/**
	 * Pre-fetch supplementary indicators for MULTIPLE assets.
	 * Free plan limitation: Only 1 construct per request, so we make sequential calls.
	 * Only BTC/USDT and ETH/USDT are supported on free plan.
	 */
	async preFetchMultipleAssets(
		assets: string[],
		interval = "1h",
	): Promise<Map<string, TaapiPreFetchResult>> {
		const results = new Map<string, TaapiPreFetchResult>();

		// Filter to only free plan symbols
		const validAssets = assets
			.map((a) => a.toUpperCase())
			.filter((a) => TAAPI_FREE_PLAN_SYMBOLS.includes(a as typeof TAAPI_FREE_PLAN_SYMBOLS[number]));

		const skippedAssets = assets.filter(
			(a) => !TAAPI_FREE_PLAN_SYMBOLS.includes(a.toUpperCase() as typeof TAAPI_FREE_PLAN_SYMBOLS[number])
		);

		if (skippedAssets.length > 0) {
			console.log(
				`[TAAPI] Skipping ${skippedAssets.join(", ")} (free plan only supports BTC, ETH)`
			);
		}

		if (validAssets.length === 0) {
			console.log("[TAAPI] No valid assets to fetch (free plan: BTC/ETH only)");
			return results;
		}

		// Check cache for all assets first
		const uncachedAssets: string[] = [];
		for (const asset of validAssets) {
			const cached = taapiCache.get<TaapiPreFetchResult>(asset, interval, "prefetch");
			if (cached) {
				console.log(`[TAAPI] Cache hit for ${asset}:${interval}`);
				results.set(asset, cached);
			} else {
				uncachedAssets.push(asset);
			}
		}

		// If all cached, return early
		if (uncachedAssets.length === 0) {
			console.log("[TAAPI] All assets served from cache");
			return results;
		}

		// Free plan only allows 1 construct per request, so fetch sequentially
		console.log(`[TAAPI] Fetching indicators for ${uncachedAssets.join(", ")} (sequential, free plan)`);

		for (const asset of uncachedAssets) {
			try {
				const prefetchResult = await this.preFetchSupplementaryIndicators(asset, interval);
				results.set(asset, prefetchResult);
			} catch (error) {
				console.error(`[TAAPI] Failed to fetch ${asset}:`, error);
				results.set(asset, {
					bbands: null,
					adx: null,
					supertrend: null,
					ichimoku: null,
					vwap: null,
					fetchedAt: Date.now(),
				});
			}
		}

		console.log(`[TAAPI] Completed fetching for ${uncachedAssets.join(", ")}`);
		return results;
	}
}

// Singleton instance
export const taapiClient = new TaapiClient();
