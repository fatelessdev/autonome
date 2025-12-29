/**
 * Strategy Variants Configuration
 *
 * Maps variant names to their corresponding system prompts and parameters.
 * Each variant represents a different trading strategy/personality that
 * can be tested in parallel.
 */

import {
	SYSTEM_PROMPT as SYSTEM_PROMPT_SITUATIONAL,
	USER_PROMPT as USER_PROMPT_SITUATIONAL,
} from "./prompt1";
import {
	SYSTEM_PROMPT as SYSTEM_PROMPT_MINIMAL,
	USER_PROMPT as USER_PROMPT_MINIMAL,
} from "./prompt2";
import {
	SYSTEM_PROMPT as SYSTEM_PROMPT_GUARDIAN,
	USER_PROMPT as USER_PROMPT_GUARDIAN,
} from "./prompt3";
import {
	SYSTEM_PROMPT as SYSTEM_PROMPT_MAX,
	USER_PROMPT as USER_PROMPT_MAX,
} from "./prompt4";

// ==========================================
// Types
// ==========================================

export type VariantId = "Situational" | "Minimal" | "Guardian" | "Max";

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
	Situational: {
		id: "Situational",
		label: "Situational Awareness",
		description: "Leaderboard-aware attack/defend posture with adaptive risk",
		systemPrompt: SYSTEM_PROMPT_SITUATIONAL,
		userPrompt: USER_PROMPT_SITUATIONAL,
		temperature: 0,
		color: "#22c55e", // green-500
	},
	Minimal: {
		id: "Minimal",
		label: "Minimal Discipline",
		description: "Concise hygiene-first prompts",
		systemPrompt: SYSTEM_PROMPT_MINIMAL,
		userPrompt: USER_PROMPT_MINIMAL,
		temperature: 0,
		color: "#3b82f6", // blue-500
	},
	Guardian: {
		id: "Guardian",
		label: "Guardian (Survival)",
		description: "Monk Mode survival: do nothing by default, strict drawdown brakes",
		systemPrompt: SYSTEM_PROMPT_GUARDIAN,
		userPrompt: USER_PROMPT_GUARDIAN,
		temperature: 0,
		color: "#a855f7", // purple-500
	},
	Max: {
		id: "Max",
		label: "Max Leverage",
		description: "ApexTrader 10x leverage with tight risk discipline",
		systemPrompt: SYSTEM_PROMPT_MAX,
		userPrompt: USER_PROMPT_MAX,
		temperature: 0,
		color: "#f59e0b", // amber-500
	},
};

/**
 * All variant IDs in display order
 */
export const VARIANT_IDS: VariantId[] = [
	"Situational",
	"Minimal",
	"Guardian",
	"Max",
];

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
export const DEFAULT_VARIANT: VariantId = "Situational";
