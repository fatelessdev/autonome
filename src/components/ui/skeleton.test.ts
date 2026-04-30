import { describe, expect, it } from "vitest";

describe("skeleton", () => {
	it("can be imported", async () => {
		const mod = await import("./skeleton");
		expect(mod).toBeDefined();
	});
});
