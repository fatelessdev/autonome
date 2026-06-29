import { describe, expect, it } from "vitest";
import { TAAPI_EXCHANGE } from "./client";

describe("TAAPI exchange", () => {
	it("uses Binance spot for free-plan indicator requests", () => {
		expect(TAAPI_EXCHANGE).toBe("binance");
	});
});
