import { describe, it, expect } from "vitest";

describe("failures", () => {
	it("can be imported", async () => {
		const mod = await import("./failures");
		expect(mod).toBeDefined();
	});
});
