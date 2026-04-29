import { describe, it, expect } from "vitest";

describe("trading", () => {
	it("can be imported", async () => {
		const mod = await import("./trading");
		expect(mod).toBeDefined();
	});
});
