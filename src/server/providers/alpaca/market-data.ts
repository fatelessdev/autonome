/**
 * Alpaca Market Data Provider
 *
 * Implements MarketDataProvider using Alpaca's Data API v2.
 * Handles both stock and crypto data endpoints.
 * Ported from MAHORAGA/src/providers/alpaca/market-data.ts.
 */

import { isCryptoMarketSymbol } from "@/core/shared/markets/marketMetadata";
import type {
	Bar,
	BarsParams,
	MarketDataProvider,
	Quote,
	Snapshot,
} from "../types";
import type { AlpacaClient } from "./client";

// ==================== Raw Alpaca Response Types ====================

interface AlpacaBarsResponse {
	bars: Record<string, AlpacaBar[]>;
	next_page_token?: string;
}

interface AlpacaBar {
	t: string;
	o: number;
	h: number;
	l: number;
	c: number;
	v: number;
	n: number;
	vw: number;
}

interface AlpacaLatestBarsResponse {
	bars: Record<string, AlpacaBar>;
}

interface AlpacaQuotesResponse {
	quotes: Record<string, AlpacaQuote>;
}

interface AlpacaQuote {
	ap: number;
	as: number;
	bp: number;
	bs: number;
	t: string;
}

interface AlpacaSnapshotsResponse {
	[symbol: string]: AlpacaSnapshot;
}

interface AlpacaSnapshot {
	latestTrade: {
		p: number;
		s: number;
		t: string;
	};
	latestQuote: AlpacaQuote;
	minuteBar: AlpacaBar;
	dailyBar: AlpacaBar;
	prevDailyBar: AlpacaBar;
}

// ==================== Parsers ====================

function parseBar(raw: AlpacaBar): Bar {
	return {
		t: raw.t,
		o: raw.o,
		h: raw.h,
		l: raw.l,
		c: raw.c,
		v: raw.v,
		n: raw.n,
		vw: raw.vw,
	};
}

function parseQuote(symbol: string, raw: AlpacaQuote): Quote {
	return {
		symbol,
		bid_price: raw.bp,
		bid_size: raw.bs,
		ask_price: raw.ap,
		ask_size: raw.as,
		timestamp: raw.t,
	};
}

function parseSnapshot(symbol: string, raw: AlpacaSnapshot): Snapshot {
	return {
		symbol,
		latest_trade: {
			price: raw.latestTrade.p,
			size: raw.latestTrade.s,
			timestamp: raw.latestTrade.t,
		},
		latest_quote: parseQuote(symbol, raw.latestQuote),
		minute_bar: parseBar(raw.minuteBar),
		daily_bar: parseBar(raw.dailyBar),
		prev_daily_bar: parseBar(raw.prevDailyBar),
	};
}

// ==================== Market Data Provider ====================

export class AlpacaMarketDataProvider implements MarketDataProvider {
	constructor(private client: AlpacaClient) {}

	async getBars(
		symbol: string,
		timeframe: string,
		params?: BarsParams,
	): Promise<Bar[]> {
		// Crypto uses multi-symbol query param endpoint (no per-symbol path)
		// Alpaca paginates crypto bars (~46 per page), so we must follow next_page_token
		if (isCryptoMarketSymbol(symbol)) {
			const allBars: Bar[] = [];
			let pageToken: string | undefined;
			const requestedLimit = params?.limit ?? 1000;

			do {
				const response = await this.client.dataRequest<AlpacaBarsResponse>(
					"GET",
					"/v1beta3/crypto/us/bars",
					{
						symbols: symbol,
						timeframe,
						start: params?.start,
						end: params?.end,
						limit: Math.min(requestedLimit - allBars.length, 10000),
						...(pageToken ? { page_token: pageToken } : {}),
					},
				);

				if (!response?.bars) break;
				const bars = response.bars[symbol];
				if (bars) {
					for (const bar of bars) {
						allBars.push(parseBar(bar));
					}
				}

				pageToken = response.next_page_token ?? undefined;
			} while (pageToken && allBars.length < requestedLimit);

			return allBars;
		}

		// Stocks use per-symbol path endpoint
		const response = await this.client.dataRequest<
			AlpacaBarsResponse | { bars: AlpacaBar[] }
		>("GET", `/v2/stocks/${encodeURIComponent(symbol)}/bars`, {
			timeframe,
			start: params?.start,
			end: params?.end,
			limit: params?.limit,
			adjustment: params?.adjustment,
			feed: params?.feed,
		});

		if (!response?.bars) return [];

		if (Array.isArray(response.bars)) {
			return response.bars.map(parseBar);
		}

		const bars = (response as AlpacaBarsResponse).bars[symbol];
		return bars ? bars.map(parseBar) : [];
	}

	async getLatestBar(symbol: string): Promise<Bar> {
		// Crypto uses multi-symbol query param endpoint (no per-symbol path)
		if (isCryptoMarketSymbol(symbol)) {
			const response = await this.client.dataRequest<AlpacaLatestBarsResponse>(
				"GET",
				"/v1beta3/crypto/us/latest/bars",
				{ symbols: symbol },
			);
			const bar = response.bars[symbol];
			if (!bar) throw new Error(`No bar data for ${symbol}`);
			return parseBar(bar);
		}

		const response = await this.client.dataRequest<AlpacaLatestBarsResponse>(
			"GET",
			`/v2/stocks/${encodeURIComponent(symbol)}/bars/latest`,
		);

		const bar = response.bars[symbol];
		if (!bar) throw new Error(`No bar data for ${symbol}`);
		return parseBar(bar);
	}

	async getLatestBars(symbols: string[]): Promise<Record<string, Bar>> {
		// Split into stock and crypto symbols
		const stockSymbols = symbols.filter((s) => !isCryptoMarketSymbol(s));
		const cryptoSymbols = symbols.filter(isCryptoMarketSymbol);
		const result: Record<string, Bar> = {};

		if (stockSymbols.length > 0) {
			const response = await this.client.dataRequest<AlpacaLatestBarsResponse>(
				"GET",
				"/v2/stocks/bars/latest",
				{ symbols: stockSymbols.join(",") },
			);
			for (const [symbol, bar] of Object.entries(response.bars)) {
				result[symbol] = parseBar(bar);
			}
		}

		if (cryptoSymbols.length > 0) {
			const response = await this.client.dataRequest<AlpacaLatestBarsResponse>(
				"GET",
				"/v1beta3/crypto/us/latest/bars",
				{ symbols: cryptoSymbols.join(",") },
			);
			for (const [symbol, bar] of Object.entries(response.bars)) {
				result[symbol] = parseBar(bar);
			}
		}

		return result;
	}

	async getQuote(symbol: string): Promise<Quote> {
		// Crypto uses multi-symbol query param endpoint (no per-symbol path)
		if (isCryptoMarketSymbol(symbol)) {
			const response = await this.client.dataRequest<AlpacaQuotesResponse>(
				"GET",
				"/v1beta3/crypto/us/latest/quotes",
				{ symbols: symbol },
			);
			const quote = response.quotes[symbol];
			if (!quote) throw new Error(`No quote data for ${symbol}`);
			return parseQuote(symbol, quote);
		}

		const response = await this.client.dataRequest<AlpacaQuotesResponse>(
			"GET",
			`/v2/stocks/${encodeURIComponent(symbol)}/quotes/latest`,
		);

		const quote = response.quotes[symbol];
		if (!quote) throw new Error(`No quote data for ${symbol}`);
		return parseQuote(symbol, quote);
	}

	async getQuotes(symbols: string[]): Promise<Record<string, Quote>> {
		const stockSymbols = symbols.filter((s) => !isCryptoMarketSymbol(s));
		const cryptoSymbols = symbols.filter(isCryptoMarketSymbol);
		const result: Record<string, Quote> = {};

		if (stockSymbols.length > 0) {
			const response = await this.client.dataRequest<AlpacaQuotesResponse>(
				"GET",
				"/v2/stocks/quotes/latest",
				{ symbols: stockSymbols.join(",") },
			);
			for (const [symbol, quote] of Object.entries(response.quotes)) {
				result[symbol] = parseQuote(symbol, quote);
			}
		}

		if (cryptoSymbols.length > 0) {
			const response = await this.client.dataRequest<AlpacaQuotesResponse>(
				"GET",
				"/v1beta3/crypto/us/latest/quotes",
				{ symbols: cryptoSymbols.join(",") },
			);
			for (const [symbol, quote] of Object.entries(response.quotes)) {
				result[symbol] = parseQuote(symbol, quote);
			}
		}

		return result;
	}

	async getSnapshot(symbol: string): Promise<Snapshot> {
		// Crypto uses dedicated endpoint, stocks use per-symbol endpoint
		if (isCryptoMarketSymbol(symbol)) {
			return this.getCryptoSnapshot(symbol);
		}

		const response = await this.client.dataRequest<
			AlpacaSnapshotsResponse | AlpacaSnapshot
		>("GET", `/v2/stocks/${encodeURIComponent(symbol)}/snapshot`);

		if (!response) {
			throw new Error(`No snapshot data for ${symbol} (market may be closed)`);
		}

		if ("latestTrade" in response) {
			return parseSnapshot(symbol, response as AlpacaSnapshot);
		}

		const snapshot = (response as AlpacaSnapshotsResponse)[symbol];
		if (!snapshot) {
			throw new Error(`No snapshot data for ${symbol} (market may be closed)`);
		}
		return parseSnapshot(symbol, snapshot);
	}

	async getSnapshots(symbols: string[]): Promise<Record<string, Snapshot>> {
		const stockSymbols = symbols.filter((s) => !isCryptoMarketSymbol(s));
		const cryptoSymbols = symbols.filter(isCryptoMarketSymbol);
		const result: Record<string, Snapshot> = {};

		if (stockSymbols.length > 0) {
			const response = await this.client.dataRequest<AlpacaSnapshotsResponse>(
				"GET",
				"/v2/stocks/snapshots",
				{ symbols: stockSymbols.join(",") },
			);
			for (const [symbol, snapshot] of Object.entries(response)) {
				result[symbol] = parseSnapshot(symbol, snapshot);
			}
		}

		if (cryptoSymbols.length > 0) {
			const response = await this.client.dataRequest<{
				snapshots: AlpacaSnapshotsResponse;
			}>("GET", "/v1beta3/crypto/us/snapshots", {
				symbols: cryptoSymbols.join(","),
			});
			for (const [symbol, snapshot] of Object.entries(
				response.snapshots ?? {},
			)) {
				result[symbol] = parseSnapshot(symbol, snapshot);
			}
		}

		return result;
	}

	async getCryptoSnapshot(symbol: string): Promise<Snapshot> {
		const response = await this.client.dataRequest<{
			snapshots: AlpacaSnapshotsResponse;
		}>("GET", "/v1beta3/crypto/us/snapshots", { symbols: symbol });

		const snapshot =
			response.snapshots?.[symbol as keyof typeof response.snapshots];
		if (!snapshot) {
			throw new Error(`No crypto snapshot data for ${symbol}`);
		}
		return parseSnapshot(symbol, snapshot);
	}
}
