import { describe, it, expect } from "vitest";

describe("seed", () => {
	it("can be imported", async () => {
		const mod = await import("./seed");
		expect(mod).toBeDefined();
	});
});
