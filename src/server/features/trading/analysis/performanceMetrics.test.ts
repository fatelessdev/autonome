import { describe, expect, it } from "vitest";

describe("performanceMetrics", () => {
	it("can be imported", async () => {
		const mod = await import("./performanceMetrics");
		expect(mod).toBeDefined();
	});
});
