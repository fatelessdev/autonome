import { describe, expect, it } from "vitest";
import { formatDuration, formatIstTimestamp } from "./dateFormat";

describe("formatDuration", () => {
	it("returns <1M for zero or negative duration", () => {
		const now = new Date();
		expect(formatDuration(now, now)).toBe("<1M");
		expect(formatDuration(now, new Date(now.getTime() - 1000))).toBe("<1M");
	});

	it("formats minutes only", () => {
		const open = new Date("2024-01-01T10:00:00Z");
		const close = new Date("2024-01-01T10:30:00Z");
		expect(formatDuration(open, close)).toBe("30M");
	});

	it("formats hours and minutes", () => {
		const open = new Date("2024-01-01T10:00:00Z");
		const close = new Date("2024-01-01T12:30:00Z");
		expect(formatDuration(open, close)).toBe("2H 30M");
	});

	it("formats days, hours, and minutes", () => {
		const open = new Date("2024-01-01T00:00:00Z");
		const close = new Date("2024-01-03T05:15:00Z");
		expect(formatDuration(open, close)).toBe("2D 5H 15M");
	});

	it("formats exactly one day (minutes always appended)", () => {
		const open = new Date("2024-01-01T00:00:00Z");
		const close = new Date("2024-01-02T00:00:00Z");
		expect(formatDuration(open, close)).toBe("1D 0M");
	});
});

describe("formatIstTimestamp", () => {
	it("returns '--' for null", () => {
		expect(formatIstTimestamp(null)).toBe("--");
	});

	it("returns '--' for undefined", () => {
		expect(formatIstTimestamp(undefined)).toBe("--");
	});

	it("returns '--' for empty string", () => {
		expect(formatIstTimestamp("")).toBe("--");
	});

	it("returns '--' for invalid date string", () => {
		expect(formatIstTimestamp("not-a-date")).toBe("--");
	});

	it("formats a valid date", () => {
		const result = formatIstTimestamp(new Date("2024-06-15T14:30:00Z"));
		// Should contain date parts (month/day and time)
		expect(result).not.toBe("--");
		expect(result).toMatch(/\d{2}\/\d{2}/);
	});

	it("formats a numeric timestamp", () => {
		const ts = new Date("2024-01-15T10:00:00Z").getTime();
		const result = formatIstTimestamp(ts);
		expect(result).not.toBe("--");
	});
});
