/**
 * Strategy Variants Configuration
 *
 * Maps variant names to their corresponding system prompts and parameters.
 * Each variant represents a different trading strategy/personality that
 * can be tested in parallel.
 *
 * Variants:
 * 1. Guardian (The Fortress) - Capital preservation, Ichimoku Cloud filter
 * 2. Apex (The Kelly Engine) - Aggressive, VWAP momentum validation
 * 3. Gladiator (Tournament) - Game theory, leaderboard-aware
 * 4. Sniper (Precision) - Confluence trading, Rule of Three
 * 5. Trendsurfer (Momentum) - Trend following, ADX filter
 * 6. Contrarian (Mean Reversion) - Fade extremes in ranging markets
 */

import {
	SYSTEM_PROMPT as SYSTEM_PROMPT_GUARDIAN,
	USER_PROMPT as USER_PROMPT_GUARDIAN,
} from "./guardian";
import {
	SYSTEM_PROMPT as SYSTEM_PROMPT_APEX,
	USER_PROMPT as USER_PROMPT_APEX,
} from "./apex";
import {
	SYSTEM_PROMPT as SYSTEM_PROMPT_GLADIATOR,
	USER_PROMPT as USER_PROMPT_GLADIATOR,
} from "./gladiator";
import {
	SYSTEM_PROMPT as SYSTEM_PROMPT_SNIPER,
	USER_PROMPT as USER_PROMPT_SNIPER,
} from "./sniper";
import {
	SYSTEM_PROMPT as SYSTEM_PROMPT_TRENDSURFER,
	USER_PROMPT as USER_PROMPT_TRENDSURFER,
} from "./trendsurfer";
import {
	SYSTEM_PROMPT as SYSTEM_PROMPT_CONTRARIAN,
	USER_PROMPT as USER_PROMPT_CONTRARIAN,
} from "./contrarian";

// ==========================================
// Types
// ==========================================

export type VariantId =
	| "Guardian"
	| "Apex"
	| "Gladiator"
	| "Sniper"
	| "Trendsurfer"
	| "Contrarian";

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
	Guardian: {
		id: "Guardian",
		label: "Guardian (Fortress)",
		description: "Capital preservation, Ichimoku Cloud hard filter, ADX safety",
		systemPrompt: SYSTEM_PROMPT_GUARDIAN,
		userPrompt: USER_PROMPT_GUARDIAN,
		temperature: 0,
		color: "#a855f7", // purple-500
	},
	Apex: {
		id: "Apex",
		label: "Apex (Kelly Engine)",
		description: "Aggressive 10x leverage, VWAP momentum validation, squeeze trading",
		systemPrompt: SYSTEM_PROMPT_APEX,
		userPrompt: USER_PROMPT_APEX,
		temperature: 0,
		color: "#f59e0b", // amber-500
	},
	Gladiator: {
		id: "Gladiator",
		label: "Gladiator (Tournament)",
		description: "Game theory based, leaderboard-aware attack/defend posture",
		systemPrompt: SYSTEM_PROMPT_GLADIATOR,
		userPrompt: USER_PROMPT_GLADIATOR,
		temperature: 0,
		color: "#22c55e", // green-500
	},
	Sniper: {
		id: "Sniper",
		label: "Sniper (Precision)",
		description: "Confluence specialist, Rule of Three, VWAP + RSI + Pattern",
		systemPrompt: SYSTEM_PROMPT_SNIPER,
		userPrompt: USER_PROMPT_SNIPER,
		temperature: 0,
		color: "#3b82f6", // blue-500
	},
	Trendsurfer: {
		id: "Trendsurfer",
		label: "Trendsurfer (Momentum)",
		description: "Trend follower, ADX > 25 filter, Kijun-Sen trailing stops",
		systemPrompt: SYSTEM_PROMPT_TRENDSURFER,
		userPrompt: USER_PROMPT_TRENDSURFER,
		temperature: 0,
		color: "#06b6d4", // cyan-500
	},
	Contrarian: {
		id: "Contrarian",
		label: "Contrarian (Reverter)",
		description: "Mean reversion in ranging markets, ADX < 25, fade to VWAP",
		systemPrompt: SYSTEM_PROMPT_CONTRARIAN,
		userPrompt: USER_PROMPT_CONTRARIAN,
		temperature: 0,
		color: "#e11d48", // rose-600
	},
};

/**
 * All variant IDs in display order
 */
export const VARIANT_IDS: VariantId[] = [
	"Guardian",
	"Apex",
	"Gladiator",
	"Sniper",
	"Trendsurfer",
	"Contrarian",
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
export const DEFAULT_VARIANT: VariantId = "Guardian";