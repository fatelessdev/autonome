import { describe, expect, it } from "vitest";

describe("index", () => {
	it("can be imported", async () => {
		const mod = await import("./index");
		expect(mod).toBeDefined();
	});
});
