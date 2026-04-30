import { describe, expect, it } from "vitest";

describe("model-legend", () => {
	it("can be imported", async () => {
		const mod = await import("./model-legend");
		expect(mod).toBeDefined();
	});
});
