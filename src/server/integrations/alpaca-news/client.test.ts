import { describe, it, expect } from "vitest";

describe("client", () => {
	it("can be imported", async () => {
		const mod = await import("./client");
		expect(mod).toBeDefined();
	});
});
