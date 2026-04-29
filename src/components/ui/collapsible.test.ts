import { describe, it, expect } from "vitest";

describe("collapsible", () => {
	it("can be imported", async () => {
		const mod = await import("./collapsible");
		expect(mod).toBeDefined();
	});
});
