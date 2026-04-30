import { describe, expect, it } from "vitest";

describe("separator", () => {
	it("can be imported", async () => {
		const mod = await import("./separator");
		expect(mod).toBeDefined();
	});
});
