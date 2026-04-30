import { describe, expect, it } from "vitest";

describe("button", () => {
	it("can be imported", async () => {
		const mod = await import("./button");
		expect(mod).toBeDefined();
	});
});
