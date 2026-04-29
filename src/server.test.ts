import { describe, it, expect } from "vitest";

describe("server", () => {
	it("can be imported", async () => {
		const mod = await import("./server");
		expect(mod).toBeDefined();
	});
});
