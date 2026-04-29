import { describe, it, expect } from "vitest";

describe("chart", () => {
	it("can be imported", async () => {
		const mod = await import("./chart");
		expect(mod).toBeDefined();
	});
});
