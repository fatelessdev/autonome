import { describe, expect, it } from "vitest";
import { getArray, isRecord, safeJsonParse } from "./json";

describe("json", () => {
	describe("isRecord", () => {
		it("returns true for plain objects", () => {
			expect(isRecord({})).toBe(true);
			expect(isRecord({ a: 1 })).toBe(true);
		});

		it("returns false for arrays", () => {
			expect(isRecord([])).toBe(false);
			expect(isRecord([1, 2])).toBe(false);
		});

		it("returns false for null", () => {
			expect(isRecord(null)).toBe(false);
		});

		it("returns false for primitives", () => {
			expect(isRecord(42)).toBe(false);
			expect(isRecord("hello")).toBe(false);
			expect(isRecord(true)).toBe(false);
			expect(isRecord(undefined)).toBe(false);
		});
	});

	describe("safeJsonParse", () => {
		it("parses valid JSON", () => {
			expect(safeJsonParse('{"a":1}', {})).toEqual({ a: 1 });
			expect(safeJsonParse('"hello"', "")).toBe("hello");
			expect(safeJsonParse("42", 0)).toBe(42);
		});

		it("returns fallback for null/undefined/empty string", () => {
			expect(safeJsonParse(null, { default: true })).toEqual({ default: true });
			expect(safeJsonParse(undefined, [])).toEqual([]);
			expect(safeJsonParse("", "fallback")).toBe("fallback");
		});

		it("returns fallback for invalid JSON", () => {
			expect(safeJsonParse("not json", {})).toEqual({});
			expect(safeJsonParse("{invalid", [])).toEqual([]);
		});

		it("returns fallback when parsed value is nullish", () => {
			// JSON.parse("null") returns null, so fallback should be used
			expect(safeJsonParse("null", "fallback")).toBe("fallback");
		});
	});

	describe("getArray", () => {
		it("returns the array when input is an array", () => {
			expect(getArray([1, 2, 3])).toEqual([1, 2, 3]);
			expect(getArray([])).toEqual([]);
		});

		it("returns empty array for non-array values", () => {
			expect(getArray(null)).toEqual([]);
			expect(getArray(undefined)).toEqual([]);
			expect(getArray("string")).toEqual([]);
			expect(getArray(42)).toEqual([]);
			expect(getArray({})).toEqual([]);
		});
	});
});
