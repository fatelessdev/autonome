import { describe, it, expect } from "vitest";

describe("tradeAgentFactory", () => {
	it("can be imported", { timeout: 30000 }, async () => {
		const mod = await import("./tradeAgentFactory");
		expect(mod).toBeDefined();
	});
});
