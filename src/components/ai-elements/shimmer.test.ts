import { describe, expect, it } from "vitest";

describe("shimmer", () => {
	it("can be imported", async () => {
		const mod = await import("./shimmer");
		expect(mod).toBeDefined();
	});
});
