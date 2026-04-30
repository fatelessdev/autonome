import { describe, it, expect } from "vitest";
import {
	normalizeNumber,
	formatCurrency,
	formatCurrencyValue,
	formatSignedCurrencyValue,
	formatQuantityValue,
	formatConfidenceValue,
	formatPercentValue,
	formatPriceLabel,
	parseSymbols,
} from "./numberFormat";

describe("numberFormat", () => {
	describe("normalizeNumber", () => {
		it("returns finite numbers as-is", () => {
			expect(normalizeNumber(42)).toBe(42);
			expect(normalizeNumber(0)).toBe(0);
			expect(normalizeNumber(-3.14)).toBe(-3.14);
		});

		it("parses numeric strings", () => {
			expect(normalizeNumber("123")).toBe(123);
			expect(normalizeNumber("3.14")).toBe(3.14);
		});

		it("returns null for non-finite", () => {
			expect(normalizeNumber(NaN)).toBeNull();
			expect(normalizeNumber(Infinity)).toBeNull();
		});

		it("returns null for null/undefined/empty", () => {
			expect(normalizeNumber(null)).toBeNull();
			expect(normalizeNumber(undefined)).toBeNull();
			expect(normalizeNumber("")).toBeNull();
		});

		it("returns null for non-numeric types", () => {
			expect(normalizeNumber(true)).toBeNull();
			expect(normalizeNumber({})).toBeNull();
		});
	});

	describe("formatCurrency", () => {
		it("formats positive numbers as USD", () => {
			expect(formatCurrency(1234.56)).toBe("$1,234.56");
		});

		it("formats zero", () => {
			expect(formatCurrency(0)).toBe("$0.00");
		});

		it("formats negative numbers", () => {
			expect(formatCurrency(-100)).toBe("-$100.00");
		});

		it("treats null/undefined as 0", () => {
			expect(formatCurrency(null)).toBe("$0.00");
			expect(formatCurrency(undefined)).toBe("$0.00");
		});

		it("parses numeric strings", () => {
			expect(formatCurrency("99.5")).toBe("$99.50");
		});
	});

	describe("formatCurrencyValue", () => {
		it("formats valid numbers as USD", () => {
			expect(formatCurrencyValue(1234.56)).toBe("$1,234.56");
		});

		it("returns N/A for null/undefined", () => {
			expect(formatCurrencyValue(null)).toBe("N/A");
			expect(formatCurrencyValue(undefined)).toBe("N/A");
		});
	});

	describe("formatSignedCurrencyValue", () => {
		it("formats positive with + prefix", () => {
			expect(formatSignedCurrencyValue(100)).toBe("+$100.00");
		});

		it("formats negative without prefix", () => {
			expect(formatSignedCurrencyValue(-100)).toBe("$100.00");
		});

		it("formats zero without prefix", () => {
			expect(formatSignedCurrencyValue(0)).toBe("$0.00");
		});

		it("returns -- for null/undefined", () => {
			expect(formatSignedCurrencyValue(null)).toBe("--");
			expect(formatSignedCurrencyValue(undefined)).toBe("--");
		});
	});

	describe("formatQuantityValue", () => {
		it("formats quantities >= 1 with 2 decimals", () => {
			expect(formatQuantityValue(1.5)).toBe("1.50");
			expect(formatQuantityValue(100)).toBe("100.00");
		});

		it("formats small quantities with precision", () => {
			expect(formatQuantityValue(0.001)).toBe("0.00100");
		});

		it("returns -- for null/undefined", () => {
			expect(formatQuantityValue(null)).toBe("--");
		});
	});

	describe("formatConfidenceValue", () => {
		it("formats decimal confidence (0-1 scale) as percentage", () => {
			expect(formatConfidenceValue(0.75)).toBe("75%");
			// 0.856 * 100 = 85.6, >= 10 so uses toFixed(0) = "86%"
			expect(formatConfidenceValue(0.856)).toBe("86%");
		});

		it("formats percentage confidence (0-100 scale)", () => {
			expect(formatConfidenceValue(75)).toBe("75%");
		});

		it("returns 100% for values >= 99.5", () => {
			expect(formatConfidenceValue(0.999)).toBe("100%");
		});

		it("returns ---- for null/undefined", () => {
			expect(formatConfidenceValue(null)).toBe("----");
			expect(formatConfidenceValue(undefined)).toBe("----");
		});
	});

	describe("formatPercentValue", () => {
		it("formats with default options", () => {
			expect(formatPercentValue(12.345)).toBe("12.35%");
		});

		it("formats with custom decimals", () => {
			expect(formatPercentValue(12.345, { decimals: 1 })).toBe("12.3%");
		});

		it("includes sign when requested", () => {
			expect(formatPercentValue(5, { includeSign: true })).toBe("+5.00%");
		});

		it("uses fallback for null", () => {
			expect(formatPercentValue(null)).toBe("N/A");
			expect(formatPercentValue(null, { fallback: "--" })).toBe("--");
		});
	});

	describe("formatPriceLabel", () => {
		it("formats prices as currency", () => {
			expect(formatPriceLabel(42.5)).toBe("$42.50");
		});

		it("returns dash for null/undefined", () => {
			expect(formatPriceLabel(null)).toBe("\u2014");
			expect(formatPriceLabel(undefined)).toBe("\u2014");
		});
	});

	describe("parseSymbols", () => {
		it("returns default symbols for null input", () => {
			const result = parseSymbols(null);
			expect(result).toEqual(["BTC", "ETH", "SOL", "XRP", "HYPE"]);
		});

		it("parses comma-separated canonical symbols", () => {
			const result = parseSymbols("BTC,ETH");
			expect(result).toEqual(["BTC", "ETH"]);
		});

		it("normalizes case and whitespace", () => {
			const result = parseSymbols(" btc , eth ");
			expect(result).toEqual(["BTC", "ETH"]);
		});

		it("deduplicates symbols", () => {
			const result = parseSymbols("BTC,btc,BTC");
			expect(result).toEqual(["BTC"]);
		});

		it("handles Alpaca-format symbols", () => {
			const result = parseSymbols("BTC/USD,ETH/USD");
			expect(result).toEqual(["BTC", "ETH"]);
		});
	});
});
