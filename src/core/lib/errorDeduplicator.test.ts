import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorDeduplicator, normalizeErrorMessage } from "./errorDeduplicator";

describe("errorDeduplicator", () => {
	describe("normalizeErrorMessage", () => {
		it("strips numbers from messages", () => {
			expect(normalizeErrorMessage("Order 12345 failed with code 500")).toBe(
				"Order <n> failed with code <n>",
			);
		});

		it("strips decimal numbers", () => {
			expect(normalizeErrorMessage("Balance 1234.56 is below 50.0")).toBe(
				"Balance <n> is below <n>",
			);
		});

		it("strips negative numbers", () => {
			expect(normalizeErrorMessage("Unrealized P&L is -42.15")).toBe(
				"Unrealized P&L is <n>",
			);
		});

		it("strips UUIDs", () => {
			expect(
				normalizeErrorMessage(
					"Failed to process order a1b2c3d4-e5f6-7890-abcd-ef1234567890",
				),
			).toBe("Failed to process order <uuid>");
		});

		it("strips ISO timestamps", () => {
			expect(
				normalizeErrorMessage(
					"Timeout at 2026-04-30T21:53:00.000Z for request 42",
				),
			).toBe("Timeout at <timestamp> for request <n>");
		});

		it("strips timestamps without milliseconds", () => {
			expect(
				normalizeErrorMessage("Stale data from 2026-04-30T21:53:00Z"),
			).toBe("Stale data from <timestamp>");
		});

		it("normalizes structurally identical errors to the same key", () => {
			const a = normalizeErrorMessage(
				"Order abc12345-abcd-1234-ef56-789012345678 filled at 105234.50",
			);
			const b = normalizeErrorMessage(
				"Order def67890-abcd-1234-ef56-789012345678 filled at 108901.25",
			);
			expect(a).toBe(b);
		});

		it("preserves static text structure", () => {
			expect(normalizeErrorMessage("Rate limit exceeded")).toBe(
				"Rate limit exceeded",
			);
		});

		it("handles empty string", () => {
			expect(normalizeErrorMessage("")).toBe("");
		});
	});

	describe("ErrorDeduplicator", () => {
		beforeEach(() => {
			vi.useFakeTimers();
		});

		afterEach(() => {
			vi.useRealTimers();
		});

		it("logs the first error normally", () => {
			const dedup = new ErrorDeduplicator();
			const result = dedup.shouldLog("something failed");
			expect(result.shouldLog).toBe(true);
			expect(result.suppressedCount).toBe(0);
		});

		it("suppresses duplicate errors within the window", () => {
			const dedup = new ErrorDeduplicator();
			dedup.shouldLog("something failed");

			const result = dedup.shouldLog("something failed");
			expect(result.shouldLog).toBe(false);
			expect(result.suppressedCount).toBe(1);
		});

		it("tracks cumulative suppressed count across multiple duplicates", () => {
			const dedup = new ErrorDeduplicator();
			dedup.shouldLog("something failed");
			dedup.shouldLog("something failed");
			dedup.shouldLog("something failed");

			const result = dedup.shouldLog("something failed");
			expect(result.shouldLog).toBe(false);
			expect(result.suppressedCount).toBe(3);
		});

		it("allows different errors to log independently", () => {
			const dedup = new ErrorDeduplicator();
			const r1 = dedup.shouldLog("error A");
			const r2 = dedup.shouldLog("error B");

			expect(r1.shouldLog).toBe(true);
			expect(r2.shouldLog).toBe(true);
		});

		it("logs fresh after the window expires", () => {
			const dedup = new ErrorDeduplicator(5_000); // 5-second window for testing

			dedup.shouldLog("something failed");

			// Advance past the window
			vi.advanceTimersByTime(5_001);

			const result = dedup.shouldLog("something failed");
			expect(result.shouldLog).toBe(true);
			expect(result.suppressedCount).toBe(0);
		});

		it("resets suppressed count when window expires", () => {
			const dedup = new ErrorDeduplicator(5_000);

			dedup.shouldLog("something failed");
			dedup.shouldLog("something failed");
			dedup.shouldLog("something failed");

			// Advance past the window
			vi.advanceTimersByTime(5_001);

			const result = dedup.shouldLog("something failed");
			expect(result.shouldLog).toBe(true);
			expect(result.suppressedCount).toBe(0);
		});

		it("uses default 5-minute window when not specified", () => {
			const dedup = new ErrorDeduplicator();

			dedup.shouldLog("something failed");

			// 4 minutes 59 seconds — still within window (from last seen)
			vi.advanceTimersByTime(299_000);
			const r1 = dedup.shouldLog("something failed");
			expect(r1.shouldLog).toBe(false);

			// 5 minutes 1 second after the last call — window expired
			// (sliding window: each duplicate resets the timer)
			vi.advanceTimersByTime(300_001);
			const r2 = dedup.shouldLog("something failed");
			expect(r2.shouldLog).toBe(true);
			expect(r2.suppressedCount).toBe(0);
		});

		it("clear resets all tracking", () => {
			const dedup = new ErrorDeduplicator();
			dedup.shouldLog("something failed");
			dedup.shouldLog("something failed");

			dedup.clear();

			const result = dedup.shouldLog("something failed");
			expect(result.shouldLog).toBe(true);
			expect(result.suppressedCount).toBe(0);
		});

		it("works end-to-end: normalize then dedup", () => {
			const dedup = new ErrorDeduplicator();

			const key1 = normalizeErrorMessage("Order 12345 failed with code 500");
			const key2 = normalizeErrorMessage("Order 99999 failed with code 503");

			// Same structure after normalization
			expect(key1).toBe(key2);

			const r1 = dedup.shouldLog(key1);
			expect(r1.shouldLog).toBe(true);

			const r2 = dedup.shouldLog(key2);
			expect(r2.shouldLog).toBe(false);
			expect(r2.suppressedCount).toBe(1);
		});
	});
});
