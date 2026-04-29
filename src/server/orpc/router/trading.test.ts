import { describe, it, expect } from "vitest";
import { getTrades, getPositions, getCryptoPrices, getPortfolioHistory } from "./trading";

describe("trading", () => {
	it("exports expected members", () => {
		expect(getTrades).toBeDefined();
		expect(getPositions).toBeDefined();
		expect(getCryptoPrices).toBeDefined();
		expect(getPortfolioHistory).toBeDefined();
	});
});
