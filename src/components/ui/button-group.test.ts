import { describe, expect, it } from "vitest";

describe("button-group", () => {
	it("can be imported", async () => {
		const mod = await import("./button-group");
		expect(mod).toBeDefined();
	});
});
