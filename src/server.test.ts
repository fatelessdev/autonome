import { describe, expect, it } from "vitest";

describe("server", () => {
	it("can be imported", async () => {
		const mod = await import("./server");
		expect(mod).toBeDefined();
	});
});
