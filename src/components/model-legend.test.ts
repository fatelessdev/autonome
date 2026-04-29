import { describe, it, expect } from "vitest";

describe("model-legend", () => {
	it("can be imported", async () => {
		const mod = await import("./model-legend");
		expect(mod).toBeDefined();
	});
});
