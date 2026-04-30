import { describe, expect, it } from "vitest";

describe("input-group", () => {
	it("can be imported", async () => {
		const mod = await import("./input-group");
		expect(mod).toBeDefined();
	});
});
