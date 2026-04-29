import { describe, it, expect } from "vitest";
import { emitTradeEvent, subscribeToTradeEvents, getCurrentTrades, getTradeCacheMetadata } from "./tradeEvents";

describe("tradeEvents", () => {
	it("exports expected members", () => {
		expect(emitTradeEvent).toBeDefined();
		expect(subscribeToTradeEvents).toBeDefined();
		expect(getCurrentTrades).toBeDefined();
		expect(getTradeCacheMetadata).toBeDefined();
	});
});
