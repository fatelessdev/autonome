import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { taapiCache } from "./cache";

describe("taapiCache", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		taapiCache.clear();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	describe("get/set", () => {
		it("returns null for missing key", () => {
			expect(taapiCache.get("BTC", "1h")).toBeNull();
		});

		it("returns stored value", () => {
			taapiCache.set("BTC", "1h", { rsi: 45 });
			expect(taapiCache.get("BTC", "1h")).toEqual({ rsi: 45 });
		});

		it("supports indicatorSet as part of key", () => {
			taapiCache.set("BTC", "1h", { rsi: 45 }, "rsi");
			taapiCache.set("BTC", "1h", { macd: 0.5 }, "macd");
			expect(taapiCache.get("BTC", "1h", "rsi")).toEqual({ rsi: 45 });
			expect(taapiCache.get("BTC", "1h", "macd")).toEqual({ macd: 0.5 });
		});

		it("differentiates by timeframe", () => {
			taapiCache.set("BTC", "1h", { rsi: 45 });
			taapiCache.set("BTC", "4h", { rsi: 60 });
			expect(taapiCache.get("BTC", "1h")).toEqual({ rsi: 45 });
			expect(taapiCache.get("BTC", "4h")).toEqual({ rsi: 60 });
		});

		it("differentiates by asset", () => {
			taapiCache.set("BTC", "1h", { rsi: 45 });
			taapiCache.set("ETH", "1h", { rsi: 60 });
			expect(taapiCache.get("BTC", "1h")).toEqual({ rsi: 45 });
			expect(taapiCache.get("ETH", "1h")).toEqual({ rsi: 60 });
		});

		it("overwrites existing value", () => {
			taapiCache.set("BTC", "1h", { rsi: 45 });
			taapiCache.set("BTC", "1h", { rsi: 70 });
			expect(taapiCache.get("BTC", "1h")).toEqual({ rsi: 70 });
		});
	});

	describe("TTL expiration", () => {
		it("returns null after TTL expires", () => {
			taapiCache.set("BTC", "1h", { rsi: 45 });
			expect(taapiCache.get("BTC", "1h")).toEqual({ rsi: 45 });

			// Advance past TTL (60 seconds)
			vi.advanceTimersByTime(61_000);
			expect(taapiCache.get("BTC", "1h")).toBeNull();
		});

		it("returns value just before TTL expires", () => {
			taapiCache.set("BTC", "1h", { rsi: 45 });
			vi.advanceTimersByTime(59_000);
			expect(taapiCache.get("BTC", "1h")).toEqual({ rsi: 45 });
		});
	});

	describe("has", () => {
		it("returns false for missing key", () => {
			expect(taapiCache.has("BTC", "1h")).toBe(false);
		});

		it("returns true for existing key", () => {
			taapiCache.set("BTC", "1h", { rsi: 45 });
			expect(taapiCache.has("BTC", "1h")).toBe(true);
		});

		it("returns false for expired key", () => {
			taapiCache.set("BTC", "1h", { rsi: 45 });
			vi.advanceTimersByTime(61_000);
			expect(taapiCache.has("BTC", "1h")).toBe(false);
		});

		it("supports indicatorSet parameter", () => {
			taapiCache.set("BTC", "1h", { rsi: 45 }, "rsi");
			expect(taapiCache.has("BTC", "1h", "rsi")).toBe(true);
			expect(taapiCache.has("BTC", "1h", "macd")).toBe(false);
		});
	});

	describe("clear", () => {
		it("removes all entries", () => {
			taapiCache.set("BTC", "1h", { rsi: 45 });
			taapiCache.set("ETH", "1h", { rsi: 60 });
			taapiCache.clear();
			expect(taapiCache.get("BTC", "1h")).toBeNull();
			expect(taapiCache.get("ETH", "1h")).toBeNull();
		});
	});

	describe("prune", () => {
		it("removes expired entries and returns count", () => {
			taapiCache.set("BTC", "1h", { rsi: 45 });
			taapiCache.set("ETH", "1h", { rsi: 60 });
			vi.advanceTimersByTime(61_000);
			taapiCache.set("SOL", "1h", { rsi: 30 });

			const pruned = taapiCache.prune();
			expect(pruned).toBe(2);
			expect(taapiCache.get("BTC", "1h")).toBeNull();
			expect(taapiCache.get("ETH", "1h")).toBeNull();
			expect(taapiCache.get("SOL", "1h")).toEqual({ rsi: 30 });
		});

		it("returns 0 when nothing to prune", () => {
			taapiCache.set("BTC", "1h", { rsi: 45 });
			expect(taapiCache.prune()).toBe(0);
		});
	});

	describe("stats", () => {
		it("returns current cache stats", () => {
			const stats = taapiCache.stats();
			expect(stats.size).toBe(0);
			expect(stats.maxSize).toBe(100);
			expect(stats.ttlSeconds).toBe(60);
		});

		it("reflects current size after inserts", () => {
			taapiCache.set("BTC", "1h", { rsi: 45 });
			taapiCache.set("ETH", "1h", { rsi: 60 });
			expect(taapiCache.stats().size).toBe(2);
		});
	});

	describe("maxSize eviction", () => {
		it("evicts oldest entry when at capacity", () => {
			// Singleton has maxSize=100, fill it up
			for (let i = 0; i < 100; i++) {
				taapiCache.set(`ASSET${i}`, "1h", { value: i });
			}
			expect(taapiCache.stats().size).toBe(100);

			// Adding a new one should evict the oldest
			taapiCache.set("NEW", "1h", { value: 99 });
			expect(taapiCache.stats().size).toBe(100);
			expect(taapiCache.get("NEW", "1h")).toEqual({ value: 99 });
			// First entry should be evicted
			expect(taapiCache.get("ASSET0", "1h")).toBeNull();
		});

		it("does not evict when updating existing key at capacity", () => {
			for (let i = 0; i < 100; i++) {
				taapiCache.set(`ASSET${i}`, "1h", { value: i });
			}
			// Update an existing key
			taapiCache.set("ASSET0", "1h", { value: 999 });
			expect(taapiCache.stats().size).toBe(100);
			expect(taapiCache.get("ASSET0", "1h")).toEqual({ value: 999 });
		});
	});
});
