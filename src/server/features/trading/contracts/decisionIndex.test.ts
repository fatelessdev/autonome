import { describe, it, expect } from "vitest";

describe("decisionIndex", () => {
	it("can be imported", async () => {
		const mod = await import("./decisionIndex");
		expect(mod).toBeDefined();
	});
});
