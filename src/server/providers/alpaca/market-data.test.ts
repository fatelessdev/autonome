import { describe, expect, it } from "vitest";

describe("market-data", () => {
	it("can be imported", async () => {
		const mod = await import("./market-data");
		expect(mod).toBeDefined();
	});
});
