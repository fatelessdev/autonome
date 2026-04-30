import { describe, expect, it } from "vitest";
import {
	DEFAULT_VARIANT,
	getAllVariantConfigs,
	getVariantBadgeClasses,
	getVariantColor,
	getVariantConfig,
	getVariantLabel,
	isValidVariantId,
	TRADEABLE_VARIANT_IDS,
	toVariantId,
	VARIANT_CONFIG,
	VARIANT_IDS,
} from "./index";

describe("variants", () => {
	describe("VARIANT_IDS", () => {
		it("contains expected variants", () => {
			expect(VARIANT_IDS).toEqual(["Trendsurfer", "Contrarian", "Sovereign"]);
		});
	});

	describe("VARIANT_CONFIG", () => {
		it("has a config entry for each variant ID", () => {
			for (const id of VARIANT_IDS) {
				expect(VARIANT_CONFIG[id]).toBeDefined();
				expect(VARIANT_CONFIG[id].id).toBe(id);
				expect(VARIANT_CONFIG[id].label).toBeTruthy();
				expect(VARIANT_CONFIG[id].color).toMatch(/^#/);
			}
		});
	});

	describe("TRADEABLE_VARIANT_IDS", () => {
		it("contains all current variants", () => {
			expect(TRADEABLE_VARIANT_IDS).toEqual([
				"Trendsurfer",
				"Contrarian",
				"Sovereign",
			]);
		});
	});

	describe("getVariantConfig", () => {
		it("returns config for valid variant", () => {
			const config = getVariantConfig("Trendsurfer");
			expect(config.id).toBe("Trendsurfer");
			expect(config.label).toBe("Trendsurfer (Momentum)");
		});

		it("returns config for each valid variant", () => {
			for (const id of VARIANT_IDS) {
				const config = getVariantConfig(id);
				expect(config.id).toBe(id);
			}
		});
	});

	describe("getAllVariantConfigs", () => {
		it("returns all configs in display order", () => {
			const configs = getAllVariantConfigs();
			expect(configs).toHaveLength(VARIANT_IDS.length);
			expect(configs.map((c) => c.id)).toEqual([...VARIANT_IDS]);
		});
	});

	describe("isValidVariantId", () => {
		it("returns true for valid variant IDs", () => {
			expect(isValidVariantId("Trendsurfer")).toBe(true);
			expect(isValidVariantId("Contrarian")).toBe(true);
			expect(isValidVariantId("Sovereign")).toBe(true);
		});

		it("returns false for invalid values", () => {
			expect(isValidVariantId("Apex")).toBe(false);
			expect(isValidVariantId("unknown")).toBe(false);
			expect(isValidVariantId("")).toBe(false);
			expect(isValidVariantId(null)).toBe(false);
			expect(isValidVariantId(undefined)).toBe(false);
			expect(isValidVariantId(42)).toBe(false);
		});
	});

	describe("toVariantId", () => {
		it("returns variant ID for valid strings", () => {
			expect(toVariantId("Trendsurfer")).toBe("Trendsurfer");
			expect(toVariantId("Contrarian")).toBe("Contrarian");
		});

		it("returns undefined for invalid values", () => {
			expect(toVariantId("Apex")).toBeUndefined();
			expect(toVariantId("unknown")).toBeUndefined();
			expect(toVariantId(null)).toBeUndefined();
			expect(toVariantId(undefined)).toBeUndefined();
		});
	});

	describe("getVariantBadgeClasses", () => {
		it("returns variant-specific classes for valid variants", () => {
			const classes = getVariantBadgeClasses("Trendsurfer");
			expect(classes).toContain("bg-cyan-500/20");
			expect(classes).toContain("text-cyan-600");
		});

		it("returns fallback classes for invalid/undefined variant", () => {
			expect(getVariantBadgeClasses(undefined)).toBe(
				"bg-zinc-500/20 text-zinc-600",
			);
			expect(getVariantBadgeClasses("unknown")).toBe(
				"bg-zinc-500/20 text-zinc-600",
			);
			expect(getVariantBadgeClasses("")).toBe("bg-zinc-500/20 text-zinc-600");
		});
	});

	describe("getVariantColor", () => {
		it("returns hex color for valid variants", () => {
			expect(getVariantColor("Trendsurfer")).toBe("#06b6d4");
			expect(getVariantColor("Contrarian")).toBe("#e11d48");
			expect(getVariantColor("Sovereign")).toBe("#eab308");
		});

		it("returns fallback color for invalid variant", () => {
			expect(getVariantColor(undefined)).toBe("#71717a");
			expect(getVariantColor("unknown")).toBe("#71717a");
		});
	});

	describe("getVariantLabel", () => {
		it("returns display label for valid variants", () => {
			expect(getVariantLabel("Trendsurfer")).toBe("Trendsurfer (Momentum)");
			expect(getVariantLabel("Contrarian")).toBe("Contrarian (Reverter)");
		});

		it("returns input string for invalid variant", () => {
			expect(getVariantLabel("unknown")).toBe("unknown");
		});

		it("returns Unknown for undefined", () => {
			expect(getVariantLabel(undefined)).toBe("Unknown");
		});
	});

	describe("DEFAULT_VARIANT", () => {
		it("is Sovereign", () => {
			expect(DEFAULT_VARIANT).toBe("Sovereign");
		});
	});
});
