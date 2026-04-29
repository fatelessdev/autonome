import { describe, it, expect } from "vitest";

describe("sidebar-tabs", () => {
	it("can be imported", async () => {
		const mod = await import("./sidebar-tabs");
		expect(mod).toBeDefined();
	});
});
