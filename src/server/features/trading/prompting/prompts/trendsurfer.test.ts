import { describe, it, expect } from "vitest";
import { SYSTEM_PROMPT, USER_PROMPT } from "./trendsurfer";

describe("trendsurfer", () => {
	it("exports expected members", () => {
		expect(SYSTEM_PROMPT).toBeDefined();
		expect(USER_PROMPT).toBeDefined();
	});
});
