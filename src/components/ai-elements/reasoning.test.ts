import { describe, expect, it } from "vitest";

describe("reasoning", () => {
	it("can be imported", async () => {
		const mod = await import("./reasoning");
		expect(mod).toBeDefined();
	});
});
