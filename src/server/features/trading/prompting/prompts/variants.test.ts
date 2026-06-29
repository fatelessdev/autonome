import { describe, expect, it } from "vitest";
import { VARIANT_IDS } from "@/core/shared/variants";
import { getAllVariants, getVariantConfig } from "./variants";

describe("prompts/variants", () => {
	describe("getVariantConfig", () => {
		it("returns config for each valid variant", () => {
			for (const id of VARIANT_IDS) {
				const config = getVariantConfig(id);
				expect(config.id).toBe(id);
				expect(config.systemPrompt).toBeTruthy();
				expect(config.userPrompt).toBeTruthy();
				expect(typeof config.temperature).toBe("number");
			}
		});

		it("Trendsurfer has expected label", () => {
			const config = getVariantConfig("Trendsurfer");
			expect(config.label).toBe("Trendsurfer (Momentum)");
			expect(config.systemPrompt.length).toBeGreaterThan(100);
		});

		it("Contrarian has expected label", () => {
			const config = getVariantConfig("Contrarian");
			expect(config.label).toBe("Contrarian (Reverter)");
		});

		it("Sovereign has expected label", () => {
			const config = getVariantConfig("Sovereign");
			expect(config.label).toBe("Sovereign (Adaptive)");
		});

		it("systemPrompt contains identity markers", () => {
			expect(getVariantConfig("Trendsurfer").systemPrompt).toContain(
				"Trendsurfer",
			);
			expect(getVariantConfig("Contrarian").systemPrompt).toContain(
				"Contrarian",
			);
			expect(getVariantConfig("Sovereign").systemPrompt).toContain("Sovereign");
		});

		it("userPrompt contains placeholder tokens", () => {
			for (const id of VARIANT_IDS) {
				const config = getVariantConfig(id);
				expect(config.userPrompt).toContain("{{CURRENT_TIME}}");
				expect(config.userPrompt).toContain("{{AVAILABLE_CASH}}");
			}
		});

		it("temperature is 0 for all variants", () => {
			for (const id of VARIANT_IDS) {
				expect(getVariantConfig(id).temperature).toBe(0);
			}
		});

		it("active prompts describe spot-only long entries and do not instruct short entries", () => {
			const forbiddenEntryPhrases = [
				/"LONG" \| "SHORT" \| "HOLD"/,
				/\bshort when\b/i,
				/\bfor shorts\b/i,
				/\bopen short\b/i,
				/\bshort entries?\b/i,
				/\benter counter-trend\b/i,
				/\benter breakout\b/i,
			];

			for (const id of VARIANT_IDS) {
				const config = getVariantConfig(id);
				const combinedPrompt = `${config.systemPrompt}\n${config.userPrompt}`;

				expect(combinedPrompt).toMatch(/spot/i);
				expect(combinedPrompt).toMatch(/LONG/i);
				expect(combinedPrompt).toMatch(/HOLD/i);
				for (const phrase of forbiddenEntryPhrases) {
					expect(combinedPrompt).not.toMatch(phrase);
				}
			}
		});
	});

	describe("getAllVariants", () => {
		it("returns one config per variant ID", () => {
			const variants = getAllVariants();
			expect(variants).toHaveLength(VARIANT_IDS.length);
		});

		it("returns configs in the same order as VARIANT_IDS", () => {
			const variants = getAllVariants();
			for (let i = 0; i < VARIANT_IDS.length; i++) {
				expect(variants[i].id).toBe(VARIANT_IDS[i]);
			}
		});

		it("each config has required fields", () => {
			for (const variant of getAllVariants()) {
				expect(variant.id).toBeTruthy();
				expect(variant.label).toBeTruthy();
				expect(variant.description).toBeTruthy();
				expect(variant.systemPrompt).toBeTruthy();
				expect(variant.userPrompt).toBeTruthy();
				expect(typeof variant.temperature).toBe("number");
			}
		});
	});
});
