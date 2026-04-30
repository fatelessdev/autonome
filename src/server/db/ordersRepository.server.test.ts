import { describe, expect, it } from "vitest";

describe("ordersRepository.server", () => {
	it("can be imported", async () => {
		const mod = await import("./ordersRepository.server");
		expect(mod).toBeDefined();
	});
});
