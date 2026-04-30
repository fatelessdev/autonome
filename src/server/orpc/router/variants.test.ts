import { describe, expect, it } from "vitest";

describe("variants", () => {
	it("can be imported", async () => {
		const mod = await import("./variants");
		expect(mod).toBeDefined();
	});
});
