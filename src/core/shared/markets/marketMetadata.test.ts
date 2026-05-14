import { describe, expect, it } from "vitest";
import {
	isCryptoMarketSymbol,
	isSupportedMarketSymbol,
	MARKETS,
	SUPPORTED_MARKETS,
	toAlpacaNewsSymbol,
	toAlpacaSymbol,
	toCanonical,
} from "./marketMetadata";

describe("marketMetadata", () => {
	describe("MARKETS", () => {
		it("contains expected crypto symbols", () => {
			expect(Object.keys(MARKETS)).toEqual([
				"BTC",
				"ETH",
				"SOL",
				"XRP",
				"HYPE",
			]);
		});

		it("each market has canonical, symbol, and assetClass", () => {
			for (const [key, market] of Object.entries(MARKETS)) {
				expect(market.canonical).toBe(key);
				expect(market.symbol).toContain("/");
				expect(market.assetClass).toBe("crypto");
			}
		});
	});

	describe("SUPPORTED_MARKETS", () => {
		it("is a list of all market keys", () => {
			expect(SUPPORTED_MARKETS).toEqual(Object.keys(MARKETS));
		});
	});

	describe("isSupportedMarketSymbol", () => {
		it("returns true for supported symbols", () => {
			expect(isSupportedMarketSymbol("BTC")).toBe(true);
			expect(isSupportedMarketSymbol("ETH")).toBe(true);
			expect(isSupportedMarketSymbol("SOL")).toBe(true);
		});

		it("returns false for unsupported symbols", () => {
			expect(isSupportedMarketSymbol("DOGE")).toBe(false);
			expect(isSupportedMarketSymbol("AVAX")).toBe(false);
			expect(isSupportedMarketSymbol("")).toBe(false);
		});
	});

	describe("toCanonical", () => {
		it("resolves canonical symbols directly", () => {
			expect(toCanonical("BTC")).toBe("BTC");
			expect(toCanonical("ETH")).toBe("ETH");
		});

		it("resolves Alpaca-format symbols", () => {
			expect(toCanonical("BTC/USD")).toBe("BTC");
			expect(toCanonical("ETH/USD")).toBe("ETH");
			expect(toCanonical("SOL/USD")).toBe("SOL");
		});
		it("resolves compact Alpaca crypto symbols", () => {
			expect(toCanonical("BTCUSD")).toBe("BTC");
			expect(toCanonical("ethusd")).toBe("ETH");
		});

		it("handles case insensitivity and whitespace", () => {
			expect(toCanonical("btc")).toBe("BTC");
			expect(toCanonical(" btc ")).toBe("BTC");
			expect(toCanonical("btc/usd")).toBe("BTC");
		});

		it("throws for unsupported symbols", () => {
			expect(() => toCanonical("DOGE")).toThrow(
				"Unsupported Alpaca market symbol",
			);
			expect(() => toCanonical("AVAX/USD")).toThrow();
		});
	});

	describe("toAlpacaSymbol", () => {
		it("resolves canonical to Alpaca format", () => {
			expect(toAlpacaSymbol("BTC")).toBe("BTC/USD");
			expect(toAlpacaSymbol("ETH")).toBe("ETH/USD");
			expect(toAlpacaSymbol("SOL")).toBe("SOL/USD");
		});

		it("handles Alpaca-format input (identity resolution)", () => {
			expect(toAlpacaSymbol("BTC/USD")).toBe("BTC/USD");
		});
		it("resolves compact Alpaca crypto symbols back to Alpaca format", () => {
			expect(toAlpacaSymbol("BTCUSD")).toBe("BTC/USD");
			expect(toAlpacaSymbol("ethusd")).toBe("ETH/USD");
		});

		it("handles case insensitivity and whitespace", () => {
			expect(toAlpacaSymbol("btc")).toBe("BTC/USD");
			expect(toAlpacaSymbol(" btc ")).toBe("BTC/USD");
		});

		it("throws for unsupported symbols", () => {
			expect(() => toAlpacaSymbol("DOGE")).toThrow(
				"Unsupported Alpaca market symbol",
			);
		});
	});

	describe("isCryptoMarketSymbol", () => {
		it("uses market metadata instead of symbol punctuation", () => {
			expect(isCryptoMarketSymbol("BTC")).toBe(true);
			expect(isCryptoMarketSymbol("BTC/USD")).toBe(true);
			expect(isCryptoMarketSymbol("BTCUSD")).toBe(true);
		});
	});

	describe("toAlpacaNewsSymbol", () => {
		it("uses compact Alpaca news format derived from the registry", () => {
			expect(toAlpacaNewsSymbol("BTC")).toBe("BTCUSD");
			expect(toAlpacaNewsSymbol("HYPE/USD")).toBe("HYPEUSD");
		});
	});
});
