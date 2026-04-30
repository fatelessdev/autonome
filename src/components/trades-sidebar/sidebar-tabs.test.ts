import { describe, expect, it } from "vitest";

describe("sidebar-tabs", () => {
	it("can be imported", async () => {
		const mod = await import("./sidebar-tabs");
		expect(mod).toBeDefined();
	});
});
