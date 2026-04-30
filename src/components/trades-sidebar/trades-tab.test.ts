import { describe, expect, it } from "vitest";

describe("trades-tab", () => {
	it("can be imported", async () => {
		const mod = await import("./trades-tab");
		expect(mod).toBeDefined();
	});
});
