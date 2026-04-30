import { describe, expect, it } from "vitest";

describe("analytics", () => {
	it("can be imported", async () => {
		const mod = await import("./analytics");
		expect(mod).toBeDefined();
	});
});
