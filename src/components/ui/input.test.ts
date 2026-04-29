import { describe, it, expect } from "vitest";

describe("input", () => {
	it("can be imported", async () => {
		const mod = await import("./input");
		expect(mod).toBeDefined();
	});
});
