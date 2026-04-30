import { describe, expect, it } from "vitest";
import { toBinanceFuturesSymbol } from "./types";

describe("toBinanceFuturesSymbol", () => {
	it("converts canonical symbol to Binance futures format", () => {
		expect(toBinanceFuturesSymbol("BTC")).toBe("BTCUSDT");
		expect(toBinanceFuturesSymbol("ETH")).toBe("ETHUSDT");
		expect(toBinanceFuturesSymbol("SOL")).toBe("SOLUSDT");
	});

	it("handles lowercase input", () => {
		expect(toBinanceFuturesSymbol("btc")).toBe("BTCUSDT");
		expect(toBinanceFuturesSymbol("eth")).toBe("ETHUSDT");
	});

	it("handles mixed case input", () => {
		expect(toBinanceFuturesSymbol("Btc")).toBe("BTCUSDT");
		expect(toBinanceFuturesSymbol("eTh")).toBe("ETHUSDT");
	});
});
