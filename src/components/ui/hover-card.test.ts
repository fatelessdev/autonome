import { describe, expect, it } from "vitest";

describe("hover-card", () => {
	it("can be imported", async () => {
		const mod = await import("./hover-card");
		expect(mod).toBeDefined();
	});
});
