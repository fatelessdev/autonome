import { describe, it, expect } from "vitest";

describe("model-filter-menu", () => {
	it("can be imported", async () => {
		const mod = await import("./model-filter-menu");
		expect(mod).toBeDefined();
	});
});
