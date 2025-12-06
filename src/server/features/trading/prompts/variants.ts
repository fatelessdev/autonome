/**
 * Strategy Variants Configuration
 *
 * Maps variant names to their corresponding system prompts and parameters.
 * Each variant represents a different trading strategy/personality that
 * can be tested in parallel.
 */

import {
	SYSTEM_PROMPT as SYSTEM_PROMPT_OG,
	USER_PROMPT as USER_PROMPT_OG,
} from "./prompt1";
import {
	SYSTEM_PROMPT as SYSTEM_PROMPT_MINIMAL,
	USER_PROMPT as USER_PROMPT_MINIMAL,
} from "./prompt2";
import {
	SYSTEM_PROMPT as SYSTEM_PROMPT_VERBOSE,
	USER_PROMPT as USER_PROMPT_VERBOSE,
} from "./prompt3";
import {
	SYSTEM_PROMPT as SYSTEM_PROMPT_AGI,
	USER_PROMPT as USER_PROMPT_AGI,
} from "./prompt4";

// ==========================================
// Types
// ==========================================

export type VariantId = "OG" | "Minimal" | "Verbose" | "AGI";

export interface VariantConfig {
	/** Unique variant identifier */
	id: VariantId;
	/** Display label for UI */
	label: string;
	/** Short description of the strategy */
	description: string;
	/** System prompt (static instructions) */
	systemPrompt: string;
	/** User prompt template (with placeholders) */
	userPrompt: string;
	/** Model temperature (0.0 - 1.0) */
	temperature: number;
	/** Color for UI charts */
	color: string;
}

// ==========================================
// Variant Configurations
// ==========================================

export const VARIANTS: Record<VariantId, VariantConfig> = {
	OG: {
		id: "OG",
		label: "OG",
		description: "Original balanced strategy with clear decision framework",
		systemPrompt: SYSTEM_PROMPT_OG,
		userPrompt: USER_PROMPT_OG,
		temperature: 0.7,
		color: "#22c55e", // green-500
	},
	Minimal: {
		id: "Minimal",
		label: "Minimal",
		description: "Concise prompts focusing on hygiene and discipline",
		systemPrompt: SYSTEM_PROMPT_MINIMAL,
		userPrompt: USER_PROMPT_MINIMAL,
		temperature: 0.5,
		color: "#3b82f6", // blue-500
	},
	Verbose: {
		id: "Verbose",
		label: "Verbose",
		description: "Detailed instructions with frontier intelligence approach",
		systemPrompt: SYSTEM_PROMPT_VERBOSE,
		userPrompt: USER_PROMPT_VERBOSE,
		temperature: 0.6,
		color: "#a855f7", // purple-500
	},
	AGI: {
		id: "AGI",
		label: "AGI",
		description: "Full autonomy with minimal constraints - ApexTrader mode",
		systemPrompt: SYSTEM_PROMPT_AGI,
		userPrompt: USER_PROMPT_AGI,
		temperature: 0.8,
		color: "#f59e0b", // amber-500
	},
};

/**
 * All variant IDs in display order
 */
export const VARIANT_IDS: VariantId[] = ["OG", "Minimal", "Verbose", "AGI"];

/**
 * Get variant config by ID
 */
export function getVariantConfig(variantId: VariantId): VariantConfig {
	const config = VARIANTS[variantId];
	if (!config) {
		throw new Error(`Unknown variant ID: ${variantId}`);
	}
	return config;
}

/**
 * Get all variant configs as array
 */
export function getAllVariants(): VariantConfig[] {
	return VARIANT_IDS.map((id) => VARIANTS[id]);
}

/**
 * Default variant for backward compatibility
 */
export const DEFAULT_VARIANT: VariantId = "OG";
