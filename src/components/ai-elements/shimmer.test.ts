import { describe, it, expect } from "vitest";

describe("shimmer", () => {
	it("can be imported", async () => {
		const mod = await import("./shimmer");
		expect(mod).toBeDefined();
	});
});
