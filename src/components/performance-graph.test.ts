import { describe, expect, it } from "vitest";

describe("performance-graph", () => {
	it("can be imported", async () => {
		const mod = await import("./performance-graph");
		expect(mod).toBeDefined();
	});
});
