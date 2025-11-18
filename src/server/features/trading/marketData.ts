import { BASE_URL } from "@/env";
import {
	type Candlestick,
	CandlestickApi,
	FundingApi,
	FundingRateExchangeEnum,
	IsomorphicFetchHttpLibrary,
	OrderApi,
	type OrderBookDetail,
	ServerConfiguration,
} from "@/lighter/generated";
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
} from "@/server/features/trading/indicators";

const SERIES_WINDOW = 10;
const INTRADAY_LIMIT = 180;
const HIGHER_TIMEFRAME_LIMIT = 90;

const serverConfiguration = new ServerConfiguration(BASE_URL, {});
const httpLibrary = new IsomorphicFetchHttpLibrary();

const candlestickApi = new CandlestickApi({
	baseServer: serverConfiguration,
	httpApi: httpLibrary,
	middleware: [],
	authMethods: {},
});

const fundingApi = new FundingApi({
	baseServer: serverConfiguration,
	httpApi: httpLibrary,
	middleware: [],
	authMethods: {},
});

const orderApi = new OrderApi({
	baseServer: serverConfiguration,
	httpApi: httpLibrary,
	middleware: [],
	authMethods: {},
});

export type Timeframe = "5m" | "4h";

export interface MarketSeriesSnapshot {
	timeframe: Timeframe;
	timestamps: string[];
	midPrices: number[];
	ema20: number[];
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
	marketId: number;
	latest: MarketSnapshotLatest;
	fundingRate: number | null;
	openInterest: {
		latest: number | null;
		average: number | null;
	};
	liquidity: {
		dailyBaseVolume: number | null;
		dailyQuoteVolume: number | null;
		dailyPriceChange: number | null;
	};
	series: {
		intraday: MarketSeriesSnapshot;
		higherTimeframe: MarketSeriesSnapshot;
	};
}

type Numberish = number | null | undefined;

const sliceLatest = <T>(values: T[], count: number): T[] =>
	values.slice(-count);

const normalizeSymbol = (value: string | undefined | null): string => {
	if (!value) return "";
	const upper = value.toUpperCase();
	return upper.endsWith("USDT") ? upper.slice(0, -4) : upper;
};

const toIsoTimestamps = (candles: Candlestick[], count: number): string[] =>
	sliceLatest(candles, count).map((candle) =>
		new Date(candle.timestamp).toISOString(),
	);

const computeAverage = (values: Numberish[]): number | null => {
	const filtered = values.filter((value): value is number =>
		Number.isFinite(value),
	);
	if (filtered.length === 0) return null;
	const sum = filtered.reduce((total, value) => total + value, 0);
	return sum / filtered.length;
};

const safeSeries = (fn: () => number[]): number[] => {
	try {
		return fn();
	} catch (error) {
		console.warn("Indicator computation failed", error);
		return [];
	}
};

const buildSeries = (
	candles: Candlestick[],
	timeframe: Timeframe,
): MarketSeriesSnapshot => {
	const closes = getCloses(candles);
	const midPrices = getMidPrices(candles);
	const volumes = getVolumes(candles);

	const ema20 = safeSeries(() => getEma(midPrices, 20));
	const macd = safeSeries(() => getMacd(midPrices));
	const rsi7 = safeSeries(() => getRsi(closes, 7));
	const rsi14 = safeSeries(() => getRsi(closes, 14));
	const atr10 = safeSeries(() => getAtr(candles, 10));
	const atr14 = safeSeries(() => getAtr(candles, 14));

	return {
		timeframe,
		timestamps: toIsoTimestamps(candles, SERIES_WINDOW),
		midPrices: roundSeries(sliceLatest(midPrices, SERIES_WINDOW)),
		ema20: roundSeries(sliceLatest(ema20, SERIES_WINDOW)),
		macd: roundSeries(sliceLatest(macd, SERIES_WINDOW)),
		rsi7: roundSeries(sliceLatest(rsi7, SERIES_WINDOW)),
		rsi14: roundSeries(sliceLatest(rsi14, SERIES_WINDOW)),
		atr10: roundSeries(sliceLatest(atr10, SERIES_WINDOW)),
		atr14: roundSeries(sliceLatest(atr14, SERIES_WINDOW)),
		volumes: roundSeries(sliceLatest(volumes, SERIES_WINDOW)),
	};
};

const fetchCandles = async (
	marketId: number,
	duration: Timeframe,
): Promise<Candlestick[]> => {
	const now = Date.now();
	const lookbackMs =
		duration === "5m"
			? 1000 * 60 * 5 * INTRADAY_LIMIT
			: 1000 * 60 * 60 * 4 * HIGHER_TIMEFRAME_LIMIT;
	const limit = duration === "5m" ? INTRADAY_LIMIT : HIGHER_TIMEFRAME_LIMIT;

	const response = await candlestickApi.candlesticks(
		marketId,
		duration,
		now - lookbackMs,
		now,
		limit,
		false,
	);

	return response.candlesticks ?? [];
};

const fetchFundingRates = async (): Promise<Map<string, number>> => {
	try {
		const response = await fundingApi.fundingRates();
		const map = new Map<string, number>();

		for (const entry of response.fundingRates ?? []) {
			const symbol = normalizeSymbol(entry.symbol);
			if (!symbol) continue;
			const existing = map.get(symbol);
			const isPreferred = entry.exchange === FundingRateExchangeEnum.Lighter;
			if (existing === undefined || isPreferred) {
				map.set(symbol, entry.rate);
			}
		}

		return map;
	} catch (error) {
		console.error("Failed to fetch funding rates", error);
		return new Map();
	}
};

const fetchOrderBookDetails = async (): Promise<
	Map<string, OrderBookDetail>
> => {
	try {
		const response = await orderApi.orderBookDetails();
		const map = new Map<string, OrderBookDetail>();
		for (const detail of response.orderBookDetails ?? []) {
			const normalized = normalizeSymbol(detail.symbol);
			if (!normalized) continue;
			map.set(normalized, detail);
		}
		return map;
	} catch (error) {
		console.error("Failed to fetch order book details", error);
		return new Map();
	}
};

const extractOpenInterestAverage = (
	detail: OrderBookDetail | undefined,
): number | null => {
	if (!detail?.dailyChart) {
		return detail?.openInterest ?? null;
	}

	const values = Object.values(detail.dailyChart).filter(
		(item): item is number => Number.isFinite(item),
	);
	if (!values.length) {
		return detail?.openInterest ?? null;
	}
	return values.reduce((sum, value) => sum + value, 0) / values.length;
};

const buildLatestSnapshot = (
	intraday: MarketSeriesSnapshot,
	higherTimeframe: MarketSeriesSnapshot,
): MarketSnapshotLatest => {
	const price =
		intraday.midPrices.at(-1) ?? higherTimeframe.midPrices.at(-1) ?? null;
	const ema20 = intraday.ema20.at(-1) ?? higherTimeframe.ema20.at(-1) ?? null;
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
		macd,
		rsi7,
		rsi14,
		atr10,
		atr14,
		volume,
		averageVolume: volumeAverage,
	};
};

export async function getMarketSnapshots(
	markets: Array<{ symbol: string; marketId: number }>,
): Promise<MarketSnapshot[]> {
	const [fundingRates, orderBookDetails] = await Promise.all([
		fetchFundingRates(),
		fetchOrderBookDetails(),
	]);

	const snapshots: MarketSnapshot[] = [];

	for (const market of markets) {
		const [intradayCandles, higherCandles] = await Promise.all([
			fetchCandles(market.marketId, "5m"),
			fetchCandles(market.marketId, "4h"),
		]);

		const intradaySeries = buildSeries(intradayCandles, "5m");
		const higherSeries = buildSeries(higherCandles, "4h");
		const latest = buildLatestSnapshot(intradaySeries, higherSeries);

		const orderDetail = orderBookDetails.get(market.symbol);

		snapshots.push({
			symbol: market.symbol,
			marketId: market.marketId,
			latest: {
				price: roundValue(latest.price),
				ema20: roundValue(latest.ema20),
				macd: roundValue(latest.macd),
				rsi7: roundValue(latest.rsi7),
				rsi14: roundValue(latest.rsi14),
				atr10: roundValue(latest.atr10),
				atr14: roundValue(latest.atr14),
				volume: roundValue(latest.volume, 2),
				averageVolume: roundValue(latest.averageVolume, 2),
			},
			fundingRate: roundValue(fundingRates.get(market.symbol) ?? null, 6),
			openInterest: {
				latest: roundValue(orderDetail?.openInterest ?? null, 2),
				average: roundValue(extractOpenInterestAverage(orderDetail), 2),
			},
			liquidity: {
				dailyBaseVolume: roundValue(
					orderDetail?.dailyBaseTokenVolume ?? null,
					2,
				),
				dailyQuoteVolume: roundValue(
					orderDetail?.dailyQuoteTokenVolume ?? null,
					2,
				),
				dailyPriceChange: roundValue(orderDetail?.dailyPriceChange ?? null, 4),
			},
			series: {
				intraday: intradaySeries,
				higherTimeframe: higherSeries,
			},
		});
	}

	return snapshots;
}

const formatNumber = (value: number | null | undefined, digits = 3): string => {
	if (!Number.isFinite(value ?? NaN)) {
		return "N/A";
	}
	return (value as number).toFixed(digits);
};

const formatSeries = (label: string, values: number[]): string => {
	if (values.length === 0) return `${label}: []`;
	return `${label}: [${values.map((value) => value.toFixed(3)).join(", ")}]`;
};

export const formatMarketSnapshots = (snapshots: MarketSnapshot[]): string => {
	if (!snapshots.length) {
		return "No market data available";
	}

	const sections = snapshots.map((snapshot) => {
		const lines: string[] = [];
		lines.push(`### ${snapshot.symbol} MARKET DATA`);
		lines.push(
			`current_price = ${formatNumber(snapshot.latest.price)}, current_ema20 = ${formatNumber(snapshot.latest.ema20)}, current_macd = ${formatNumber(snapshot.latest.macd)}, current_rsi_7 = ${formatNumber(snapshot.latest.rsi7)}, current_rsi_14 = ${formatNumber(snapshot.latest.rsi14)}`,
		);

		lines.push(
			`current_atr_10 = ${formatNumber(snapshot.latest.atr10)}, current_atr_14 = ${formatNumber(snapshot.latest.atr14)}, current_volume = ${formatNumber(snapshot.latest.volume, 2)} vs. average_volume = ${formatNumber(snapshot.latest.averageVolume, 2)}`,
		);

		lines.push(
			`funding_rate = ${formatNumber(snapshot.fundingRate, 6)}, open_interest_latest = ${formatNumber(snapshot.openInterest.latest, 2)}, open_interest_average = ${formatNumber(snapshot.openInterest.average, 2)}`,
		);

		if (
			snapshot.liquidity.dailyQuoteVolume != null ||
			snapshot.liquidity.dailyBaseVolume != null
		) {
			lines.push(
				`daily_volume_quote = ${formatNumber(snapshot.liquidity.dailyQuoteVolume, 2)}, daily_volume_base = ${formatNumber(snapshot.liquidity.dailyBaseVolume, 2)}, daily_price_change = ${formatNumber(snapshot.liquidity.dailyPriceChange, 4)}`,
			);
		}

		lines.push("**Intraday (5m, oldest → newest)**");
		lines.push(formatSeries("Mid prices", snapshot.series.intraday.midPrices));
		lines.push(formatSeries("EMA20", snapshot.series.intraday.ema20));
		lines.push(formatSeries("MACD", snapshot.series.intraday.macd));
		lines.push(formatSeries("RSI (7)", snapshot.series.intraday.rsi7));
		lines.push(formatSeries("RSI (14)", snapshot.series.intraday.rsi14));
		lines.push(formatSeries("ATR (10)", snapshot.series.intraday.atr10));
		lines.push(formatSeries("ATR (14)", snapshot.series.intraday.atr14));
		lines.push(formatSeries("Volumes", snapshot.series.intraday.volumes));

		lines.push("**Higher timeframe (4h, oldest → newest)**");
		lines.push(
			formatSeries("Mid prices", snapshot.series.higherTimeframe.midPrices),
		);
		lines.push(formatSeries("EMA20", snapshot.series.higherTimeframe.ema20));
		lines.push(formatSeries("MACD", snapshot.series.higherTimeframe.macd));
		lines.push(formatSeries("RSI (7)", snapshot.series.higherTimeframe.rsi7));
		lines.push(formatSeries("RSI (14)", snapshot.series.higherTimeframe.rsi14));
		lines.push(formatSeries("ATR (10)", snapshot.series.higherTimeframe.atr10));
		lines.push(formatSeries("ATR (14)", snapshot.series.higherTimeframe.atr14));
		lines.push(
			formatSeries("Volumes", snapshot.series.higherTimeframe.volumes),
		);

		return lines.join("\n");
	});

	return sections.join("\n\n");
};
