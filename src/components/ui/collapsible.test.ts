import { describe, expect, it } from "vitest";

describe("collapsible", () => {
	it("can be imported", async () => {
		const mod = await import("./collapsible");
		expect(mod).toBeDefined();
	});
});
