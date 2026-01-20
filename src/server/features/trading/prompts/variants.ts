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
 * 7. Sovereign (Adaptive) - Flexible regime-adaptive allocator
 */

import {
	VARIANT_IDS,
	VARIANT_CONFIG,
	DEFAULT_VARIANT,
	type VariantId,
	type VariantConfig as SharedVariantConfig,
} from "@/core/shared/variants";

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
import {
	SYSTEM_PROMPT as SYSTEM_PROMPT_SOVEREIGN,
	USER_PROMPT as USER_PROMPT_SOVEREIGN,
} from "./sovereign";

// Re-export from SSOT for backward compatibility
export { VARIANT_IDS, VARIANT_CONFIG as VARIANTS, DEFAULT_VARIANT };
export type { VariantId };

// ==========================================
// Extended Types with Prompts
// ==========================================

export interface VariantConfig extends SharedVariantConfig {
	/** System prompt (static instructions) */
	systemPrompt: string;
	/** User prompt template (with placeholders) */
	userPrompt: string;
	/** Model temperature (0.0 - 1.0) */
	temperature: number;
}

// ==========================================
// Variant Configurations with Prompts
// ==========================================

/**
 * Extended variant configurations including prompts.
 * Builds on top of VARIANT_CONFIG from shared module.
 */
export const VARIANT_PROMPTS: Record<VariantId, VariantConfig> = {
	Guardian: {
		...VARIANT_CONFIG.Guardian,
		systemPrompt: SYSTEM_PROMPT_GUARDIAN,
		userPrompt: USER_PROMPT_GUARDIAN,
		temperature: 0,
	},
	Apex: {
		...VARIANT_CONFIG.Apex,
		systemPrompt: SYSTEM_PROMPT_APEX,
		userPrompt: USER_PROMPT_APEX,
		temperature: 0,
	},
	Gladiator: {
		...VARIANT_CONFIG.Gladiator,
		systemPrompt: SYSTEM_PROMPT_GLADIATOR,
		userPrompt: USER_PROMPT_GLADIATOR,
		temperature: 0,
	},
	Sniper: {
		...VARIANT_CONFIG.Sniper,
		systemPrompt: SYSTEM_PROMPT_SNIPER,
		userPrompt: USER_PROMPT_SNIPER,
		temperature: 0,
	},
	Trendsurfer: {
		...VARIANT_CONFIG.Trendsurfer,
		systemPrompt: SYSTEM_PROMPT_TRENDSURFER,
		userPrompt: USER_PROMPT_TRENDSURFER,
		temperature: 0,
	},
	Contrarian: {
		...VARIANT_CONFIG.Contrarian,
		systemPrompt: SYSTEM_PROMPT_CONTRARIAN,
		userPrompt: USER_PROMPT_CONTRARIAN,
		temperature: 0,
	},
	Sovereign: {
		...VARIANT_CONFIG.Sovereign,
		systemPrompt: SYSTEM_PROMPT_SOVEREIGN,
		userPrompt: USER_PROMPT_SOVEREIGN,
		temperature: 0,
	},
};

/**
 * Get variant config by ID (with prompts)
 */
export function getVariantConfig(variantId: VariantId): VariantConfig {
	const config = VARIANT_PROMPTS[variantId];
	if (!config) {
		throw new Error(`Unknown variant ID: ${variantId}`);
	}
	return config;
}

/**
 * Get all variant configs as array (with prompts)
 */
export function getAllVariants(): VariantConfig[] {
	return VARIANT_IDS.map((id) => VARIANT_PROMPTS[id]);
}