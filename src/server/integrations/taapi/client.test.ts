import { describe, expect, it } from "vitest";

describe("client", () => {
	it("can be imported", async () => {
		const mod = await import("./client");
		expect(mod).toBeDefined();
	});
});
