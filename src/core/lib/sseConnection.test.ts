import { describe, it, expect } from "vitest";
import { createSseConnection } from "./sseConnection";

describe("sseConnection", () => {
	it("exports expected members", () => {
		expect(createSseConnection).toBeDefined();
	});
});
