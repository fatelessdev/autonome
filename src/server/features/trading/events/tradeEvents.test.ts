import { describe, expect, it } from "vitest";
import {
	emitTradeEvent,
	getCurrentTrades,
	getTradeCacheMetadata,
	subscribeToTradeEvents,
} from "./tradeEvents";

describe("tradeEvents", () => {
	it("exports expected members", () => {
		expect(emitTradeEvent).toBeDefined();
		expect(subscribeToTradeEvents).toBeDefined();
		expect(getCurrentTrades).toBeDefined();
		expect(getTradeCacheMetadata).toBeDefined();
	});
});
