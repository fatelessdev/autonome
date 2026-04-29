import { describe, it, expect } from "vitest";

describe("priceTracker", () => {
	it("can be imported", async () => {
		const mod = await import("./priceTracker");
		expect(mod).toBeDefined();
	});
});
