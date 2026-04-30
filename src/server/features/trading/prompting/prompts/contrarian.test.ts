import { describe, it, expect } from "vitest";
import { SYSTEM_PROMPT, USER_PROMPT } from "./contrarian";

describe("contrarian", () => {
	it("exports expected members", () => {
		expect(SYSTEM_PROMPT).toBeDefined();
		expect(USER_PROMPT).toBeDefined();
	});

	it("contains fee awareness section", () => {
		expect(SYSTEM_PROMPT).toContain("FEE & SLIPPAGE AWARENESS");
		expect(SYSTEM_PROMPT).toContain("round-trip cost");
		expect(SYSTEM_PROMPT).toContain("~0.1-0.3%");
		expect(SYSTEM_PROMPT).toContain("profit targets MUST exceed fee drag");
	});
});
