import { describe, expect, it } from "vitest";

describe("checkbox", () => {
	it("can be imported", async () => {
		const mod = await import("./checkbox");
		expect(mod).toBeDefined();
	});
});
