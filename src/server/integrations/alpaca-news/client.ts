/**
 * Alpaca News Client
 *
 * Fetches recent news articles from the Alpaca News API (/v1beta1/news).
 * Includes a TTL-based cache with in-flight deduplication (same pattern as marketIntelligenceCache).
 * News is fetched once per trade cycle and shared across all model invocations.
 */

import type { AlpacaNewsResponse, NewsDigestItem } from "./types";

const NEWS_API_URL = "https://data.alpaca.markets/v1beta1/news";
const FETCH_TIMEOUT_MS = 15_000;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes (matches trade cycle interval)
const NEWS_LIMIT = 10;
const NEWS_LOOKBACK_MS = 5 * 60 * 1000; // Last 5 minutes

interface NewsCacheEntry {
	items: NewsDigestItem[];
	formatted: string;
	fetchedAt: number;
}

declare global {
	// eslint-disable-next-line no-var
	var __alpacaNewsCache: NewsCacheEntry | null | undefined;
	// eslint-disable-next-line no-var
	var __alpacaNewsFetchPromise: Promise<NewsCacheEntry> | null | undefined;
}

if (typeof globalThis.__alpacaNewsCache === "undefined") {
	globalThis.__alpacaNewsCache = null;
}
if (typeof globalThis.__alpacaNewsFetchPromise === "undefined") {
	globalThis.__alpacaNewsFetchPromise = null;
}

/**
 * Fetch news articles from Alpaca.
 * Uses query params: symbols for our crypto universe, last 5 min window, limit 10, include content.
 */
async function fetchNewsFromAlpaca(credentials: {
	alpacaApiKey: string;
	alpacaApiSecret: string;
}): Promise<NewsDigestItem[]> {
	const now = new Date();
	const start = new Date(now.getTime() - NEWS_LOOKBACK_MS);

	// Alpaca news uses symbols without "/" (BTCUSD not BTC/USD)
	// Include all our traded symbols + DOGE for broader crypto context
	const cryptoSymbols = [
		"BTCUSD",
		"ETHUSD",
		"SOLUSD",
		"XRPUSD",
		"DOGEUSD",
		"HYPEUSD",
	];

	const params = new URLSearchParams({
		start: start.toISOString(),
		end: now.toISOString(),
		symbols: cryptoSymbols.join(","),
		limit: String(NEWS_LIMIT),
		include_content: "true",
		exclude_contentless: "true",
		sort: "desc",
	});

	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

	try {
		const response = await fetch(`${NEWS_API_URL}?${params}`, {
			method: "GET",
			headers: {
				"APCA-API-KEY-ID": credentials.alpacaApiKey,
				"APCA-API-SECRET-KEY": credentials.alpacaApiSecret,
				Accept: "application/json",
			},
			signal: controller.signal,
		});

		clearTimeout(timeoutId);

		if (!response.ok) {
			console.warn(
				`[AlpacaNews] API returned ${response.status}: ${await response.text()}`,
			);
			return [];
		}

		const data = (await response.json()) as AlpacaNewsResponse;

		return (data.news ?? []).map((article) => ({
			headline: article.headline,
			summary: article.summary || "",
			source: article.source,
			symbols: article.symbols,
			publishedAt: article.created_at,
		}));
	} catch (error) {
		clearTimeout(timeoutId);
		if (error instanceof Error && error.name === "AbortError") {
			console.warn("[AlpacaNews] Fetch timed out after 15s");
		} else {
			console.warn("[AlpacaNews] Fetch failed:", error);
		}
		return [];
	}
}

/**
 * Format news articles into a prompt-friendly section.
 */
function formatNewsDigest(items: NewsDigestItem[]): string {
	if (items.length === 0) return "";

	const lines: string[] = [];
	lines.push("## RECENT NEWS (Last 5 min)");

	for (const article of items) {
		const symbols =
			article.symbols.length > 0 ? ` [${article.symbols.join(", ")}]` : "";
		const time = new Date(article.publishedAt).toLocaleTimeString("en-US", {
			hour: "2-digit",
			minute: "2-digit",
			hour12: true,
		});
		lines.push(
			`- **${article.headline}**${symbols} (${article.source}, ${time})`,
		);
		if (article.summary) {
			lines.push(`  ${article.summary}`);
		}
	}

	return lines.join("\n");
}

/**
 * Get cached news digest, fetching fresh data if cache is stale.
 * Multiple concurrent calls share the same in-flight fetch.
 */
export async function getSharedNewsDigest(credentials: {
	alpacaApiKey: string;
	alpacaApiSecret: string;
}): Promise<{ items: NewsDigestItem[]; formatted: string }> {
	const now = Date.now();
	const cached = globalThis.__alpacaNewsCache;

	if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
		return { items: cached.items, formatted: cached.formatted };
	}

	if (globalThis.__alpacaNewsFetchPromise) {
		const result = await globalThis.__alpacaNewsFetchPromise;
		return { items: result.items, formatted: result.formatted };
	}

	const fetchPromise = (async (): Promise<NewsCacheEntry> => {
		const items = await fetchNewsFromAlpaca(credentials);
		const formatted = formatNewsDigest(items);

		const entry: NewsCacheEntry = { items, formatted, fetchedAt: Date.now() };
		globalThis.__alpacaNewsCache = entry;
		return entry;
	})();

	globalThis.__alpacaNewsFetchPromise = fetchPromise;

	try {
		const result = await fetchPromise;
		return { items: result.items, formatted: result.formatted };
	} finally {
		globalThis.__alpacaNewsFetchPromise = null;
	}
}

/**
 * Invalidate the news cache, forcing a fresh fetch on next access.
 */
export function invalidateNewsCache(): void {
	globalThis.__alpacaNewsCache = null;
}
