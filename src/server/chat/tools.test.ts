import { describe, expect, it } from "vitest";

describe("tools", () => {
	it("can be imported", async () => {
		const mod = await import("./tools");
		expect(mod).toBeDefined();
	});
});
