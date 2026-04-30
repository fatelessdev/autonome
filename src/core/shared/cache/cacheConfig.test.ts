import { describe, expect, it } from "vitest";
import { CACHE_TIMING, createQueryKey, QUERY_KEY_PREFIX } from "./cacheConfig";

describe("cacheConfig", () => {
	it("exports expected members", () => {
		expect(CACHE_TIMING).toBeDefined();
		expect(CACHE_TIMING.REALTIME).toBe(15_000);
		expect(CACHE_TIMING.STANDARD).toBe(30_000);
		expect(CACHE_TIMING.SLOW).toBe(60_000);
		expect(CACHE_TIMING.STATIC).toBe(120_000);
		expect(QUERY_KEY_PREFIX).toBeDefined();
		expect(createQueryKey).toBeDefined();
	});
});
