// Candlestick interface matching the SDK's response format
export interface Candlestick {
	timestamp: number;
	open: number;
	high: number;
	low: number;
	close: number;
	volume?: number;
	volume0?: number; // base token volume in new SDK
	volume1?: number; // quote token volume in new SDK
}

const assertValidPeriod = (period: number) => {
	if (!Number.isInteger(period) || period <= 0) {
		throw new Error(
			`Indicator period must be a positive integer, received: ${period}`,
		);
	}
};

export function getEma(prices: number[], period: number): number[] {
	assertValidPeriod(period);
	if (prices.length < period) {
		return [];
	}

	const multiplier = 2 / (period + 1);
	let sma = 0;
	for (let i = 0; i < period; i++) {
		sma += prices[i];
	}
	sma /= period;

	const values = [sma];
	for (let i = period; i < prices.length; i++) {
		const prev = values[values.length - 1];
		const ema = prev * (1 - multiplier) + prices[i] * multiplier;
		values.push(ema);
	}

	return values;
}

export function getSma(prices: number[], period: number): number[] {
	assertValidPeriod(period);
	if (prices.length < period) {
		return [];
	}

	const values: number[] = [];
	let windowSum = 0;

	for (let i = 0; i < prices.length; i++) {
		windowSum += prices[i];
		if (i >= period) {
			windowSum -= prices[i - period];
		}
		if (i >= period - 1) {
			values.push(windowSum / period);
		}
	}

	return values;
}

export function getMidPrices(candlesticks: Candlestick[]): number[] {
	return candlesticks.map(({ open, close }) => (open + close) / 2);
}

export function getCloses(candlesticks: Candlestick[]): number[] {
	return candlesticks.map((candle) => candle.close);
}

export function getVolumes(candlesticks: Candlestick[]): number[] {
	// volume0 is base token volume in the new SDK (volume1 is quote token volume)
	return candlesticks.map((candle, index) => {
		const volume = candle.volume0 ?? candle.volume;
		if (volume == null || !Number.isFinite(volume)) {
			throw new Error(
				`Missing or invalid volume for candlestick at index ${index}`,
			);
		}
		return volume;
	});
}

export function getMacd(prices: number[]): number[] {
	const ema26 = getEma(prices, 26);
	let ema12 = getEma(prices, 12);
	ema12 = ema12.slice(-ema26.length);
	return ema12.map((value, idx) => value - ema26[idx]);
}

export function getRsi(prices: number[], period: number): number[] {
	assertValidPeriod(period);
	if (prices.length < period + 1) {
		return [];
	}

	let gains = 0;
	let losses = 0;
	for (let i = 1; i <= period; i++) {
		const delta = prices[i] - prices[i - 1];
		if (delta >= 0) {
			gains += delta;
		} else {
			losses -= delta;
		}
	}

	let avgGain = gains / period;
	let avgLoss = losses / period;
	const rsis: number[] = [];

	const computeRsi = () => {
		if (avgLoss === 0) {
			return avgGain === 0 ? 50 : 100;
		}
		const rs = avgGain / avgLoss;
		return 100 - 100 / (1 + rs);
	};

	rsis.push(computeRsi());

	for (let i = period + 1; i < prices.length; i++) {
		const delta = prices[i] - prices[i - 1];
		const gain = Math.max(delta, 0);
		const loss = Math.max(-delta, 0);
		avgGain = (avgGain * (period - 1) + gain) / period;
		avgLoss = (avgLoss * (period - 1) + loss) / period;
		rsis.push(computeRsi());
	}

	return rsis;
}

export function getAtr(candlesticks: Candlestick[], period: number): number[] {
	assertValidPeriod(period);
	if (candlesticks.length < period) {
		return [];
	}

	const trueRanges: number[] = [];
	for (let i = 0; i < candlesticks.length; i++) {
		const current = candlesticks[i];
		const prevClose = i > 0 ? candlesticks[i - 1].close : current.close;
		const highLow = current.high - current.low;
		const highPrev = Math.abs(current.high - prevClose);
		const lowPrev = Math.abs(current.low - prevClose);
		trueRanges.push(Math.max(highLow, highPrev, lowPrev));
	}

	let atr =
		trueRanges.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
	const values = [atr];
	for (let i = period; i < trueRanges.length; i++) {
		atr = (atr * (period - 1) + trueRanges[i]) / period;
		values.push(atr);
	}

	return values;
}

export function getRollingAverage(values: number[], period: number): number[] {
	assertValidPeriod(period);
	if (values.length < period) {
		return [];
	}

	const result: number[] = [];
	let windowSum = 0;

	for (let i = 0; i < values.length; i++) {
		windowSum += values[i];
		if (i >= period) {
			windowSum -= values[i - period];
		}
		if (i >= period - 1) {
			result.push(windowSum / period);
		}
	}

	return result;
}

export function getRollingStdDev(values: number[], period: number): number[] {
	assertValidPeriod(period);
	if (values.length < period) {
		return [];
	}

	const result: number[] = [];
	const queue: number[] = [];
	let sum = 0;

	for (let i = 0; i < values.length; i++) {
		const value = values[i];
		queue.push(value);
		sum += value;

		if (queue.length > period) {
			const shifted = queue.shift();
			if (shifted == null) {
				throw new Error("Rolling stddev queue underflow");
			}
			sum -= shifted;
		}

		if (queue.length === period) {
			const mean = sum / period;
			const variance =
				queue.reduce((acc, current) => {
					const diff = current - mean;
					return acc + diff * diff;
				}, 0) / period;
			result.push(Math.sqrt(variance));
		}
	}

	return result;
}

export const roundSeries = (values: number[], digits = 3): number[] =>
	values.map((value) => Number(value.toFixed(digits)));

export const roundValue = (
	value: number | null | undefined,
	digits = 3,
): number | null => {
	if (value == null || !Number.isFinite(value)) {
		return null;
	}
	return Number(value.toFixed(digits));
};

export const toPercent = (
	value: number | null | undefined,
	digits = 3,
): number | null => {
	if (value == null || !Number.isFinite(value)) {
		return null;
	}
	return Number((value * 100).toFixed(digits));
};
