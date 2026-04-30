import { describe, expect, it } from "vitest";

describe("textarea", () => {
	it("can be imported", async () => {
		const mod = await import("./textarea");
		expect(mod).toBeDefined();
	});
});
