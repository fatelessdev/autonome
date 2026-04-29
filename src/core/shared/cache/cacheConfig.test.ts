import { describe, it, expect } from "vitest";
import { CACHE_TIMING, QUERY_KEY_PREFIX, createQueryKey } from "./cacheConfig";

describe("cacheConfig", () => {
	it("exports expected members", () => {
		expect(CACHE_TIMING).toBeDefined();
		expect(QUERY_KEY_PREFIX).toBeDefined();
		expect(createQueryKey).toBeDefined();
	});
});
