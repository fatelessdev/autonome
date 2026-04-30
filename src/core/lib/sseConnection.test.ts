import { describe, expect, it } from "vitest";
import { createSseConnection } from "./sseConnection";

describe("sseConnection", () => {
	it("exports expected members", () => {
		expect(createSseConnection).toBeDefined();
	});
});
