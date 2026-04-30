import { describe, expect, it } from "vitest";

describe("model-filter-menu", () => {
	it("can be imported", async () => {
		const mod = await import("./model-filter-menu");
		expect(mod).toBeDefined();
	});
});
