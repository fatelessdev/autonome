import { describe, expect, it } from "vitest";

describe("variant-selector", () => {
	it("can be imported", async () => {
		const mod = await import("./variant-selector");
		expect(mod).toBeDefined();
	});
});
