import { describe, it, expect } from "vitest";
import { SYSTEM_PROMPT, USER_PROMPT } from "./prompt1";

describe("prompt1", () => {
	it("exports expected members", () => {
		expect(SYSTEM_PROMPT).toBeDefined();
		expect(USER_PROMPT).toBeDefined();
	});
});
