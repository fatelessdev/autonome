import { describe, it, expect } from "vitest";
import { client, orpc } from "./client";

describe("client", () => {
	it("exports expected members", () => {
		expect(client).toBeDefined();
		expect(orpc).toBeDefined();
	});
});
