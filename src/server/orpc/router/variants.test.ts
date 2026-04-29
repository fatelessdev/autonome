import { describe, it, expect } from "vitest";

describe("variants", () => {
	it("can be imported", async () => {
		const mod = await import("./variants");
		expect(mod).toBeDefined();
	});
});
