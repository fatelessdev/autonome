import { describe, expect, it } from "vitest";
import { MAX_ACTIONS_PER_SYMBOL, MINIMUM_TRADE_SIZE_USD } from "./types";

describe("types", () => {
	it("exports MAX_ACTIONS_PER_SYMBOL", () => {
		expect(MAX_ACTIONS_PER_SYMBOL).toBeDefined();
		expect(MAX_ACTIONS_PER_SYMBOL).toBe(3);
	});

	it("exports MINIMUM_TRADE_SIZE_USD", () => {
		expect(MINIMUM_TRADE_SIZE_USD).toBeDefined();
		expect(MINIMUM_TRADE_SIZE_USD).toBe(50);
	});
});
