import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
	clampCooldownMinutes,
	calculateCooldownUntil,
	DEFAULT_COOLDOWN_MINUTES,
	MIN_COOLDOWN_MINUTES,
	MAX_COOLDOWN_MINUTES,
} from "./cooldown";

describe("cooldown", () => {
	describe("constants", () => {
		it("has correct default cooldown", () => {
			expect(DEFAULT_COOLDOWN_MINUTES).toBe(15);
		});

		it("has correct min cooldown", () => {
			expect(MIN_COOLDOWN_MINUTES).toBe(1);
		});

		it("has correct max cooldown", () => {
			expect(MAX_COOLDOWN_MINUTES).toBe(15);
		});
	});

	describe("clampCooldownMinutes", () => {
		it("returns default when input is null", () => {
			expect(clampCooldownMinutes(null)).toBe(DEFAULT_COOLDOWN_MINUTES);
		});

		it("returns default when input is undefined", () => {
			expect(clampCooldownMinutes(undefined)).toBe(DEFAULT_COOLDOWN_MINUTES);
		});

		it("clamps to MIN when value is too low", () => {
			expect(clampCooldownMinutes(0)).toBe(MIN_COOLDOWN_MINUTES);
			expect(clampCooldownMinutes(-5)).toBe(MIN_COOLDOWN_MINUTES);
			expect(clampCooldownMinutes(0.5)).toBe(MIN_COOLDOWN_MINUTES);
		});

		it("clamps to MAX when value is too high", () => {
			expect(clampCooldownMinutes(20)).toBe(MAX_COOLDOWN_MINUTES);
			expect(clampCooldownMinutes(100)).toBe(MAX_COOLDOWN_MINUTES);
		});

		it("returns the value when within range", () => {
			expect(clampCooldownMinutes(1)).toBe(1);
			expect(clampCooldownMinutes(5)).toBe(5);
			expect(clampCooldownMinutes(10)).toBe(10);
			expect(clampCooldownMinutes(15)).toBe(15);
		});

		it("handles boundary values correctly", () => {
			expect(clampCooldownMinutes(MIN_COOLDOWN_MINUTES)).toBe(
				MIN_COOLDOWN_MINUTES,
			);
			expect(clampCooldownMinutes(MAX_COOLDOWN_MINUTES)).toBe(
				MAX_COOLDOWN_MINUTES,
			);
		});
	});

	describe("calculateCooldownUntil", () => {
		beforeEach(() => {
			vi.useFakeTimers();
			vi.setSystemTime(new Date("2025-01-15T12:00:00Z"));
		});

		afterEach(() => {
			vi.useRealTimers();
		});

		it("returns ISO date string", () => {
			const result = calculateCooldownUntil(5);
			expect(() => new Date(result)).not.toThrow();
			expect(new Date(result).toISOString()).toBe(result);
		});

		it("adds the specified minutes to current time", () => {
			const result = calculateCooldownUntil(10);
			const expected = new Date(
				Date.now() + 10 * 60 * 1000,
			).toISOString();
			expect(result).toBe(expected);
		});

		it("uses default cooldown when no argument given", () => {
			const result = calculateCooldownUntil();
			const expected = new Date(
				Date.now() + DEFAULT_COOLDOWN_MINUTES * 60 * 1000,
			).toISOString();
			expect(result).toBe(expected);
		});

		it("clamps value to valid range", () => {
			const tooLow = calculateCooldownUntil(0);
			const expectedMin = new Date(
				Date.now() + MIN_COOLDOWN_MINUTES * 60 * 1000,
			).toISOString();
			expect(tooLow).toBe(expectedMin);

			const tooHigh = calculateCooldownUntil(60);
			const expectedMax = new Date(
				Date.now() + MAX_COOLDOWN_MINUTES * 60 * 1000,
			).toISOString();
			expect(tooHigh).toBe(expectedMax);
		});

		it("handles null input with default", () => {
			const result = calculateCooldownUntil(null);
			const expected = new Date(
				Date.now() + DEFAULT_COOLDOWN_MINUTES * 60 * 1000,
			).toISOString();
			expect(result).toBe(expected);
		});
	});
});
