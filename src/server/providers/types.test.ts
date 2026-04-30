import { describe, expect, it } from "vitest";

describe("types", () => {
	it("can be imported", async () => {
		const mod = await import("./types");
		expect(mod).toBeDefined();
	});
});
