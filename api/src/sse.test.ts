import { describe, it, expect } from "vitest";
import { createSseHandler } from "./sse";

describe("sse", () => {
	it("exports expected members", () => {
		expect(createSseHandler).toBeDefined();
	});
});
