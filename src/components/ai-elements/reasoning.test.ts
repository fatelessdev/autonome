import { describe, it, expect } from "vitest";

describe("reasoning", () => {
	it("can be imported", async () => {
		const mod = await import("./reasoning");
		expect(mod).toBeDefined();
	});
});
