import { describe, expect, it } from "vitest";

describe("competitionSnapshot", () => {
	it("can be imported", async () => {
		const mod = await import("./competitionSnapshot");
		expect(mod).toBeDefined();
	});
});
