import { describe, it, expect } from "vitest";

describe("input-group", () => {
	it("can be imported", async () => {
		const mod = await import("./input-group");
		expect(mod).toBeDefined();
	});
});
