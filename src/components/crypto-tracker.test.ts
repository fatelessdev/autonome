import { describe, expect, it } from "vitest";

describe("crypto-tracker", () => {
	it("can be imported", async () => {
		const mod = await import("./crypto-tracker");
		expect(mod).toBeDefined();
	});
});
