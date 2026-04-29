import { describe, it, expect } from "vitest";

describe("scroll-area", () => {
	it("can be imported", async () => {
		const mod = await import("./scroll-area");
		expect(mod).toBeDefined();
	});
});
