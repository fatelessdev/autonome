import { getNextTaapiKey, getTaapiKeyCount } from "@/env";
import { taapiCache } from "./cache";
import type {
	ADXResult,
	BBandsResult,
	IchimokuResult,
	SupertrendResult,
	TaapiBulkPayload,
	TaapiBulkResponse,
	TaapiIndicatorConfig,
	TaapiPreFetchResult,
	VWAPResult,
} from "./types";
import { TAAPI_FREE_PLAN_SYMBOLS } from "./types";

const BULK_URL = "https://api.taapi.io/bulk";
const FETCH_TIMEOUT_MS = 30_000;

export const TAAPI_EXCHANGE = "binance" as const;

const getTaapiApiKey = (): string => {
	try {
		return getNextTaapiKey();
	} catch {
		throw new Error("[TAAPI] No TAAPI API keys configured");
	}
};

export class TaapiClient {
	private async postWithRetry(
		payload: TaapiBulkPayload,
		retries = 3,
		backoffMs = 15000, // 15 seconds for free plan
	): Promise<TaapiBulkResponse> {
		for (let attempt = 0; attempt < retries; attempt++) {
			try {
				const controller = new AbortController();
				const timeoutId = setTimeout(
					() => controller.abort(),
					FETCH_TIMEOUT_MS,
				);

				const response = await fetch(BULK_URL, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(payload),
					signal: controller.signal,
				});

				clearTimeout(timeoutId);

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
				const isAborted = error instanceof Error && error.name === "AbortError";
				const isTimeout =
					error instanceof Error &&
					(error.message.includes("timeout") || isAborted);
				const isNetworkError =
					error instanceof Error &&
					(error.message.includes("fetch") ||
						error.message.includes("network"));

				if ((isTimeout || isNetworkError) && attempt < retries - 1) {
					const wait = backoffMs * (attempt + 1);
					console.warn(
						`[TAAPI] ${isAborted ? "Timeout" : "Network error"}, retrying in ${Math.round(wait / 1000)}s`,
					);
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
			return cached;
		}

		const apiKey = getTaapiApiKey();

		const payload: TaapiBulkPayload = {
			secret: apiKey,
			construct: {
				exchange: TAAPI_EXCHANGE,
				symbol,
				interval,
				indicators,
			},
		};

		const response = await this.postWithRetry(payload);

		const results: Record<string, unknown> = {};
		for (const item of response.data) {
			if (item.errors && item.errors.length > 0) {
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

	isConfigured(): boolean {
		return getTaapiKeyCount() > 0;
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
			.filter((a) =>
				TAAPI_FREE_PLAN_SYMBOLS.includes(
					a as (typeof TAAPI_FREE_PLAN_SYMBOLS)[number],
				),
			);

		if (validAssets.length === 0) {
			return results;
		}

		const uncachedAssets: string[] = [];
		for (const asset of validAssets) {
			const cached = taapiCache.get<TaapiPreFetchResult>(
				asset,
				interval,
				"prefetch",
			);
			if (cached) {
				results.set(asset, cached);
			} else {
				uncachedAssets.push(asset);
			}
		}

		if (uncachedAssets.length === 0) {
			return results;
		}

		for (const asset of uncachedAssets) {
			try {
				const prefetchResult = await this.preFetchSupplementaryIndicators(
					asset,
					interval,
				);
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

		return results;
	}
}

export const taapiClient = new TaapiClient();
