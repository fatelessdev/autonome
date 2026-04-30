import { describe, expect, it } from "vitest";

describe("exit-plan-dialog", () => {
	it("can be imported", async () => {
		const mod = await import("./exit-plan-dialog");
		expect(mod).toBeDefined();
	});
});
