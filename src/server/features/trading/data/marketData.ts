/**
 * Market Data (Alpaca)
 *
 * Fetches candlestick data from Alpaca's Data API and computes technical indicators.
 * Replaces the previous Lighter-based implementation.
 * Indicator computation logic (EMA, RSI, MACD, ATR) is preserved from the original.
 */

import type { Candlestick } from "@/server/features/trading/data/technicalIndicators";
import {
	getAtr,
	getCloses,
	getEma,
	getMacd,
	getMidPrices,
	getRsi,
	getVolumes,
	roundSeries,
	roundValue,
} from "@/server/features/trading/data/technicalIndicators";
import { getMarketDataProvider } from "@/server/providers/alpaca";
import type { AlpacaMarketDataProvider } from "@/server/providers/alpaca/market-data";
import type { Bar } from "@/server/providers/types";

const SERIES_WINDOW = 10;
const INTRADAY_LIMIT = 180;
const HIGHER_TIMEFRAME_LIMIT = 90;

export type Timeframe = "5Min" | "4Hour";

export interface MarketSeriesSnapshot {
	timeframe: Timeframe;
	timestamps: string[];
	midPrices: number[];
	ema20: number[];
	ema50: number[];
	macd: number[];
	rsi7: number[];
	rsi14: number[];
	atr10: number[];
	atr14: number[];
	volumes: number[];
}

export interface MarketSnapshotLatest {
	price: number | null;
	ema20: number | null;
	ema50: number | null;
	macd: number | null;
	rsi7: number | null;
	rsi14: number | null;
	atr10: number | null;
	atr14: number | null;
	volume: number | null;
	averageVolume: number | null;
}

export interface MarketSnapshot {
	symbol: string;
	latest: MarketSnapshotLatest;
	series: {
		intraday: MarketSeriesSnapshot;
		higherTimeframe: MarketSeriesSnapshot;
	};
}

// ==========================================
// Helpers
// ==========================================

const sliceLatest = <T>(values: T[], count: number): T[] =>
	values.slice(-count);

const toIsoTimestamps = (candles: Candlestick[], count: number): string[] =>
	sliceLatest(candles, count).map((candle) =>
		new Date(candle.timestamp).toISOString(),
	);

type Numberish = number | null | undefined;

const computeAverage = (values: Numberish[]): number | null => {
	const filtered = values.filter((value): value is number =>
		Number.isFinite(value),
	);
	if (filtered.length === 0) return null;
	return filtered.reduce((total, value) => total + value, 0) / filtered.length;
};

/**
 * Convert Alpaca bars to our internal Candlestick format.
 */
function barsToCandlesticks(bars: Bar[]): Candlestick[] {
	return bars.map((bar) => ({
		timestamp: new Date(bar.t).getTime(),
		open: bar.o,
		high: bar.h,
		low: bar.l,
		close: bar.c,
		volume: bar.v,
	}));
}

const buildSeries = (
	candles: Candlestick[],
	timeframe: Timeframe,
): MarketSeriesSnapshot => {
	const closes = getCloses(candles);
	const midPrices = getMidPrices(candles);
	const volumes = getVolumes(candles);

	const ema20 = getEma(midPrices, 20);
	const ema50 = getEma(midPrices, 50);
	const macd = getMacd(midPrices);
	const rsi7 = getRsi(closes, 7);
	const rsi14 = getRsi(closes, 14);
	const atr10 = getAtr(candles, 10);
	const atr14 = getAtr(candles, 14);

	return {
		timeframe,
		timestamps: toIsoTimestamps(candles, SERIES_WINDOW),
		midPrices: roundSeries(sliceLatest(midPrices, SERIES_WINDOW)),
		ema20: roundSeries(sliceLatest(ema20, SERIES_WINDOW)),
		ema50: roundSeries(sliceLatest(ema50, SERIES_WINDOW)),
		macd: roundSeries(sliceLatest(macd, SERIES_WINDOW)),
		rsi7: roundSeries(sliceLatest(rsi7, SERIES_WINDOW)),
		rsi14: roundSeries(sliceLatest(rsi14, SERIES_WINDOW)),
		atr10: roundSeries(sliceLatest(atr10, SERIES_WINDOW)),
		atr14: roundSeries(sliceLatest(atr14, SERIES_WINDOW)),
		volumes: roundSeries(sliceLatest(volumes, SERIES_WINDOW), 6),
	};
};

const buildLatestSnapshot = (
	intraday: MarketSeriesSnapshot,
	higherTimeframe: MarketSeriesSnapshot,
): MarketSnapshotLatest => {
	const price =
		intraday.midPrices.at(-1) ?? higherTimeframe.midPrices.at(-1) ?? null;
	const ema20 = intraday.ema20.at(-1) ?? higherTimeframe.ema20.at(-1) ?? null;
	const ema50 = intraday.ema50.at(-1) ?? higherTimeframe.ema50.at(-1) ?? null;
	const macd = intraday.macd.at(-1) ?? higherTimeframe.macd.at(-1) ?? null;
	const rsi7 = intraday.rsi7.at(-1) ?? higherTimeframe.rsi7.at(-1) ?? null;
	const rsi14 = intraday.rsi14.at(-1) ?? higherTimeframe.rsi14.at(-1) ?? null;
	const atr10 = intraday.atr10.at(-1) ?? higherTimeframe.atr10.at(-1) ?? null;
	const atr14 = intraday.atr14.at(-1) ?? higherTimeframe.atr14.at(-1) ?? null;
	const volume = intraday.volumes.at(-1) ?? null;
	const volumeAverage = computeAverage(
		sliceLatest(intraday.volumes, Math.min(30, intraday.volumes.length)),
	);

	return {
		price,
		ema20,
		ema50,
		macd,
		rsi7,
		rsi14,
		atr10,
		atr14,
		volume,
		averageVolume: volumeAverage,
	};
};

// ==========================================
// Data Fetching
// ==========================================

async function fetchBars(
	provider: AlpacaMarketDataProvider,
	alpacaSymbol: string,
	timeframe: string,
	limit: number,
): Promise<Candlestick[]> {
	// Calculate start time based on timeframe and limit
	const now = new Date();
	const lookbackMs =
		timeframe === "5Min" ? 1000 * 60 * 5 * limit : 1000 * 60 * 60 * 4 * limit;
	const start = new Date(now.getTime() - lookbackMs);

	const bars = await provider.getBars(alpacaSymbol, timeframe, {
		start: start.toISOString(),
		end: now.toISOString(),
		limit,
	});
	if (bars.length === 0) {
		throw new Error(
			`No market bars returned for ${alpacaSymbol} (${timeframe}, limit=${limit})`,
		);
	}

	return barsToCandlesticks(bars);
}

// ==========================================
// Public API
// ==========================================

export async function getMarketSnapshots(
	markets: Array<{ symbol: string; alpacaSymbol: string }>,
	credentials: { alpacaApiKey: string; alpacaApiSecret: string },
): Promise<MarketSnapshot[]> {
	const provider = getMarketDataProvider(
		credentials.alpacaApiKey,
		credentials.alpacaApiSecret,
	);

	// Fetch all markets in parallel — each market needs two timeframe requests
	const snapshots = await Promise.all(
		markets.map(async (market) => {
			const [intradayCandles, higherCandles] = await Promise.all([
				fetchBars(provider, market.alpacaSymbol, "5Min", INTRADAY_LIMIT),
				fetchBars(
					provider,
					market.alpacaSymbol,
					"4Hour",
					HIGHER_TIMEFRAME_LIMIT,
				),
			]);

			const intradaySeries = buildSeries(intradayCandles, "5Min");
			const higherSeries = buildSeries(higherCandles, "4Hour");
			const latest = buildLatestSnapshot(intradaySeries, higherSeries);

			return {
				symbol: market.symbol,
				latest: {
					price: roundValue(latest.price),
					ema20: roundValue(latest.ema20),
					ema50: roundValue(latest.ema50),
					macd: roundValue(latest.macd),
					rsi7: roundValue(latest.rsi7),
					rsi14: roundValue(latest.rsi14),
					atr10: roundValue(latest.atr10),
					atr14: roundValue(latest.atr14),
					volume: roundValue(latest.volume, 6),
					averageVolume: roundValue(latest.averageVolume, 6),
				},
				series: {
					intraday: intradaySeries,
					higherTimeframe: higherSeries,
				},
			};
		}),
	);

	return snapshots;
}

// ==========================================
// Formatting (for prompts)
// ==========================================

const formatNumber = (value: number | null | undefined, digits = 3): string => {
	if (!Number.isFinite(value ?? NaN)) {
		return "N/A";
	}
	return (value as number).toFixed(digits);
};

const formatSeries = (label: string, values: number[], digits = 3): string => {
	if (values.length === 0) return `${label}: []`;
	return `${label}: [${values.map((v) => v.toFixed(digits)).join(", ")}]`;
};

export const formatMarketSnapshots = (snapshots: MarketSnapshot[]): string => {
	if (!snapshots.length) {
		return "No market data available";
	}

	const sections = snapshots.map((snapshot) => {
		const lines: string[] = [];
		lines.push(`### ${snapshot.symbol} MARKET DATA`);
		lines.push(
			`current_price = ${formatNumber(snapshot.latest.price)}, current_ema20 = ${formatNumber(snapshot.latest.ema20)}, current_ema50 = ${formatNumber(snapshot.latest.ema50)}, current_macd = ${formatNumber(snapshot.latest.macd)}, current_rsi_7 = ${formatNumber(snapshot.latest.rsi7)}, current_rsi_14 = ${formatNumber(snapshot.latest.rsi14)}`,
		);

		lines.push(
			`current_atr_10 = ${formatNumber(snapshot.latest.atr10)}, current_atr_14 = ${formatNumber(snapshot.latest.atr14)}, current_volume = ${formatNumber(snapshot.latest.volume, 6)} vs. average_volume = ${formatNumber(snapshot.latest.averageVolume, 6)}`,
		);

		lines.push("**Intraday (5m, oldest -> newest)**");
		lines.push(formatSeries("Mid prices", snapshot.series.intraday.midPrices));
		lines.push(formatSeries("EMA20", snapshot.series.intraday.ema20));
		lines.push(formatSeries("EMA50", snapshot.series.intraday.ema50));
		lines.push(formatSeries("MACD", snapshot.series.intraday.macd));
		lines.push(formatSeries("RSI (7)", snapshot.series.intraday.rsi7));
		lines.push(formatSeries("RSI (14)", snapshot.series.intraday.rsi14));
		lines.push(formatSeries("ATR (10)", snapshot.series.intraday.atr10));
		lines.push(formatSeries("ATR (14)", snapshot.series.intraday.atr14));
		lines.push(formatSeries("Volumes", snapshot.series.intraday.volumes, 6));

		lines.push("**Higher timeframe (4h, oldest -> newest)**");
		lines.push(
			formatSeries("Mid prices", snapshot.series.higherTimeframe.midPrices),
		);
		lines.push(formatSeries("EMA20", snapshot.series.higherTimeframe.ema20));
		lines.push(formatSeries("EMA50", snapshot.series.higherTimeframe.ema50));
		lines.push(formatSeries("MACD", snapshot.series.higherTimeframe.macd));
		lines.push(formatSeries("RSI (7)", snapshot.series.higherTimeframe.rsi7));
		lines.push(formatSeries("RSI (14)", snapshot.series.higherTimeframe.rsi14));
		lines.push(formatSeries("ATR (10)", snapshot.series.higherTimeframe.atr10));
		lines.push(formatSeries("ATR (14)", snapshot.series.higherTimeframe.atr14));
		lines.push(
			formatSeries("Volumes", snapshot.series.higherTimeframe.volumes, 6),
		);

		return lines.join("\n");
	});

	return sections.join("\n\n");
};
