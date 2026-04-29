import { describe, it, expect } from "vitest";

describe("tooltip", () => {
	it("can be imported", async () => {
		const mod = await import("./tooltip");
		expect(mod).toBeDefined();
	});
});
