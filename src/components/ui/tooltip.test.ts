import { describe, expect, it } from "vitest";

describe("tooltip", () => {
	it("can be imported", async () => {
		const mod = await import("./tooltip");
		expect(mod).toBeDefined();
	});
});
