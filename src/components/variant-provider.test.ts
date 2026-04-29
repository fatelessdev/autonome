import { describe, it, expect } from "vitest";

describe("variant-provider", () => {
	it("can be imported", async () => {
		const mod = await import("./variant-provider");
		expect(mod).toBeDefined();
	});
});
