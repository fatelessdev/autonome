import { describe, it, expect } from "vitest";

describe("performance-graph", () => {
	it("can be imported", async () => {
		const mod = await import("./performance-graph");
		expect(mod).toBeDefined();
	});
});
