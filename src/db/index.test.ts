import { describe, it, expect } from "vitest";
import { db } from "./index";

describe("index", () => {
	it("exports expected members", () => {
		expect(db).toBeDefined();
	});
});
