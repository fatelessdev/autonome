import { describe, it, expect } from "vitest";
import { SYSTEM_PROMPT, USER_PROMPT } from "./prompt5";

describe("prompt5", () => {
	it("exports expected members", () => {
		expect(SYSTEM_PROMPT).toBeDefined();
		expect(USER_PROMPT).toBeDefined();
	});
});
