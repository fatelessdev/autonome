import { describe, expect, it } from "vitest";

describe("trading", () => {
	it("can be imported", async () => {
		const mod = await import("./trading");
		expect(mod).toBeDefined();
	});
});
