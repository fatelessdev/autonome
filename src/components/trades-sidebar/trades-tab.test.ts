import { describe, it, expect } from "vitest";

describe("trades-tab", () => {
	it("can be imported", async () => {
		const mod = await import("./trades-tab");
		expect(mod).toBeDefined();
	});
});
