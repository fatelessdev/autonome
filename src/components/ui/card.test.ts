import { describe, expect, it } from "vitest";

describe("card", () => {
	it("can be imported", async () => {
		const mod = await import("./card");
		expect(mod).toBeDefined();
	});
});
