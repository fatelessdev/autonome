import { describe, it, expect } from "vitest";

describe("types", () => {
	it("can be imported", async () => {
		const mod = await import("./types");
		expect(mod).toBeDefined();
	});
});
