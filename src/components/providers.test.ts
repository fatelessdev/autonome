import { describe, expect, it } from "vitest";

describe("providers", () => {
	it("can be imported", async () => {
		const mod = await import("./providers");
		expect(mod).toBeDefined();
	});
});
