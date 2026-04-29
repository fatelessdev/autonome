import { describe, it, expect } from "vitest";
import { formatMarketSnapshots } from "./marketData";
import type { MarketSnapshot } from "./marketData";

const makeSnapshot = (
	overrides: Partial<MarketSnapshot> = {},
): MarketSnapshot => ({
	symbol: "BTC",
	latest: {
		price: 65000.123,
		ema20: 64500.456,
		ema50: 63000.789,
		macd: 150.321,
		rsi7: 72.5,
		rsi14: 68.3,
		atr10: 500.1,
		atr14: 520.2,
		volume: 1234.56789,
		averageVolume: 1100.12345,
	},
	series: {
		intraday: {
			timeframe: "5Min",
			timestamps: ["2025-01-01T00:00:00Z", "2025-01-01T00:05:00Z"],
			midPrices: [65000, 65100],
			ema20: [64500, 64520],
			ema50: [63000, 63010],
			macd: [150, 155],
			rsi7: [72, 73],
			rsi14: [68, 69],
			atr10: [500, 501],
			atr14: [520, 521],
			volumes: [1234.56, 1240.12],
		},
		higherTimeframe: {
			timeframe: "4Hour",
			timestamps: ["2025-01-01T00:00:00Z", "2025-01-01T04:00:00Z"],
			midPrices: [64000, 64800],
			ema20: [63500, 64000],
			ema50: [62000, 62500],
			macd: [100, 120],
			rsi7: [65, 70],
			rsi14: [62, 66],
			atr10: [480, 490],
			atr14: [500, 510],
			volumes: [5000.5, 5200.3],
		},
	},
	...overrides,
});

describe("marketData", () => {
	describe("formatMarketSnapshots", () => {
		it("returns 'No market data available' for empty array", () => {
			expect(formatMarketSnapshots([])).toBe("No market data available");
		});

		it("includes symbol header", () => {
			const result = formatMarketSnapshots([makeSnapshot()]);
			expect(result).toContain("### BTC MARKET DATA");
		});

		it("includes current price and indicators", () => {
			const result = formatMarketSnapshots([makeSnapshot()]);
			expect(result).toContain("current_price = 65000.123");
			expect(result).toContain("current_rsi_7 = 72.500");
		});

		it("includes intraday section", () => {
			const result = formatMarketSnapshots([makeSnapshot()]);
			expect(result).toContain("**Intraday (5m, oldest -> newest)**");
			expect(result).toContain("Mid prices: [65000.000, 65100.000]");
		});

		it("includes higher timeframe section", () => {
			const result = formatMarketSnapshots([makeSnapshot()]);
			expect(result).toContain(
				"**Higher timeframe (4h, oldest -> newest)**",
			);
			expect(result).toContain("EMA20: [63500.000, 64000.000]");
		});

		it("formats N/A for null values", () => {
			const snapshot = makeSnapshot();
			snapshot.latest.price = null;
			const result = formatMarketSnapshots([snapshot]);
			expect(result).toContain("current_price = N/A");
		});

		it("handles multiple snapshots", () => {
			const btc = makeSnapshot({ symbol: "BTC" });
			const eth = makeSnapshot({ symbol: "ETH" });
			const result = formatMarketSnapshots([btc, eth]);

			expect(result).toContain("### BTC MARKET DATA");
			expect(result).toContain("### ETH MARKET DATA");
		});

		it("includes volume with 6 decimal precision", () => {
			const result = formatMarketSnapshots([makeSnapshot()]);
			expect(result).toContain("current_volume = 1234.567890");
		});
	});
});
