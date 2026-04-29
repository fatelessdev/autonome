import { describe, it, expect } from "vitest";

describe("card", () => {
	it("can be imported", async () => {
		const mod = await import("./card");
		expect(mod).toBeDefined();
	});
});
