import { describe, expect, it } from "vitest";

describe("use-trading-dashboard-data", () => {
	it("can be imported", async () => {
		const mod = await import("./use-trading-dashboard-data");
		expect(mod).toBeDefined();
	});
});
