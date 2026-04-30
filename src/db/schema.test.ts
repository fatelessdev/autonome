import { describe, expect, it } from "vitest";

describe("schema", () => {
	it("can be imported", async () => {
		const mod = await import("./schema");
		expect(mod).toBeDefined();
	});
});
