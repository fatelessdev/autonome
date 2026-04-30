import { describe, expect, it } from "vitest";
import { createSseHandler } from "./sse";

describe("sse", () => {
	it("exports expected members", () => {
		expect(createSseHandler).toBeDefined();
	});
});
