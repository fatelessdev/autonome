import { describe, expect, it } from "vitest";

describe("table", () => {
	it("can be imported", async () => {
		const mod = await import("./table");
		expect(mod).toBeDefined();
	});
});
