/**
 * Binance Open Interest Client
 *
 * Fetches open interest data from Binance Futures API (free, no auth required).
 * Uses the /futures/data/openInterestHist endpoint for historical OI data,
 * which allows computing % change over the lookback window.
 *
 * Endpoints used:
 * - GET /futures/data/openInterestHist?symbol=BTCUSDT&period=1h&limit=25
 *
 * Response: Array of { symbol, sumOpenInterest, sumOpenInterestValue, timestamp }
 */

import { MARKETS } from "@/core/shared/markets/marketMetadata";
import type {
	BinanceOiHistoryItem,
	OpenInterestData,
	OpenInterestMap,
} from "./types";
import { toBinanceFuturesSymbol } from "./types";

const BASE_URL = "https://fapi.binance.com";
const FETCH_TIMEOUT_MS = 10_000;
const OI_HIST_PERIOD = "1h";
const OI_HIST_LIMIT = 25; // ~25 hours of history for change calculation

/**
 * Fetch open interest history from Binance Futures for a single symbol.
 * Returns an array of historical OI data points.
 */
async function fetchOiHistory(
	binanceSymbol: string,
): Promise<BinanceOiHistoryItem[]> {
	const url = new URL("/futures/data/openInterestHist", BASE_URL);
	url.searchParams.set("symbol", binanceSymbol);
	url.searchParams.set("period", OI_HIST_PERIOD);
	url.searchParams.set("limit", OI_HIST_LIMIT.toString());

	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

	try {
		const response = await fetch(url.toString(), {
			signal: controller.signal,
			headers: { Accept: "application/json" },
		});

		clearTimeout(timeoutId);

		if (!response.ok) {
			const text = await response.text();
			throw new Error(
				`Binance OI API error: ${response.status} ${response.statusText} - ${text}`,
			);
		}

		return (await response.json()) as BinanceOiHistoryItem[];
	} catch (error) {
		clearTimeout(timeoutId);
		throw error;
	}
}

/**
 * Compute percentage change between the earliest and latest OI value.
 * Returns 0 if insufficient data.
 */
function computeChangePercent(items: BinanceOiHistoryItem[]): number {
	if (items.length < 2) return 0;

	const earliest = Number(items[0].sumOpenInterest);
	const latest = Number(items[items.length - 1].sumOpenInterest);

	if (
		!Number.isFinite(earliest) ||
		!Number.isFinite(latest) ||
		earliest === 0
	) {
		return 0;
	}

	return ((latest - earliest) / earliest) * 100;
}

/**
 * Fetch open interest data for a single crypto asset.
 * Returns parsed OI data or null if the fetch fails.
 */
async function fetchOpenInterestForAsset(
	canonicalSymbol: string,
): Promise<OpenInterestData | null> {
	const binanceSymbol = toBinanceFuturesSymbol(canonicalSymbol);

	try {
		const history = await fetchOiHistory(binanceSymbol);

		if (history.length === 0) {
			return null;
		}

		const latest = history[history.length - 1];
		const openInterest = Number(latest.sumOpenInterest);
		const openInterestValueUsd = Number(latest.sumOpenInterestValue);

		if (
			!Number.isFinite(openInterest) ||
			!Number.isFinite(openInterestValueUsd)
		) {
			return null;
		}

		const changePercent = computeChangePercent(history);

		return {
			symbol: canonicalSymbol,
			openInterest,
			openInterestValueUsd,
			changePercent,
			timestamp: latest.timestamp,
		};
	} catch (error) {
		console.error(
			`[Binance OI] Failed to fetch OI for ${canonicalSymbol}:`,
			error instanceof Error ? error.message : error,
		);
		return null;
	}
}

/**
 * Fetch open interest data for all traded crypto assets.
 * Returns a map of canonical symbol → OI data.
 * Assets that fail to fetch are omitted from the map (graceful degradation).
 */
export async function fetchAllOpenInterest(
	symbols?: string[],
): Promise<OpenInterestMap> {
	const targets = symbols ?? Object.keys(MARKETS);
	const results: OpenInterestMap = new Map();

	// Fetch all symbols in parallel with individual error handling
	const promises = targets.map(async (canonical) => {
		const data = await fetchOpenInterestForAsset(canonical);
		if (data) {
			results.set(canonical, data);
		}
	});

	await Promise.allSettled(promises);

	return results;
}
