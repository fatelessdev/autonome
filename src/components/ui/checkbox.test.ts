import { describe, it, expect } from "vitest";

describe("checkbox", () => {
	it("can be imported", async () => {
		const mod = await import("./checkbox");
		expect(mod).toBeDefined();
	});
});
