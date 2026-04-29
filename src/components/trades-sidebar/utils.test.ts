import { describe, it, expect } from "vitest";
import { formatDecisionSymbol } from "./utils";

describe("utils", () => {
	it("can be imported", async () => {
		const mod = await import("./utils");
		expect(mod).toBeDefined();
	});

	it("formats synthetic decision symbols safely", () => {
		expect(formatDecisionSymbol("PORTFOLIO")).toBe("PORTFOLIO");
		expect(formatDecisionSymbol("btc/usd")).toBe("BTC");
	});
});
