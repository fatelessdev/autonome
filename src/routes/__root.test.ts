import { describe, it, expect } from "vitest";

describe("__root", () => {
	it("can be imported", async () => {
		const mod = await import("./__root");
		expect(mod).toBeDefined();
	});
});
