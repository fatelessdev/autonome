import { describe, expect, it } from "vitest";
import {
	getCryptoPrices,
	getPortfolioHistory,
	getPositions,
	getTrades,
} from "./trading";

describe("trading", () => {
	it("exports expected members", () => {
		expect(getTrades).toBeDefined();
		expect(getPositions).toBeDefined();
		expect(getCryptoPrices).toBeDefined();
		expect(getPortfolioHistory).toBeDefined();
	});
});
