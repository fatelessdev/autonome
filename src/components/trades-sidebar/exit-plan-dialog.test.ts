import { describe, it, expect } from "vitest";

describe("exit-plan-dialog", () => {
	it("can be imported", async () => {
		const mod = await import("./exit-plan-dialog");
		expect(mod).toBeDefined();
	});
});
