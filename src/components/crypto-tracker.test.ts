import { describe, it, expect } from "vitest";

describe("crypto-tracker", () => {
	it("can be imported", async () => {
		const mod = await import("./crypto-tracker");
		expect(mod).toBeDefined();
	});
});
