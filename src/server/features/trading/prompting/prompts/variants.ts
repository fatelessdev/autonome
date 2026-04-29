import {
	type VariantConfig as SharedVariantConfig,
	VARIANT_CONFIG,
	VARIANT_IDS,
	type VariantId,
} from "@/core/shared/variants";
import {
	SYSTEM_PROMPT as SYSTEM_PROMPT_CONTRARIAN,
	USER_PROMPT as USER_PROMPT_CONTRARIAN,
} from "./contrarian";
import {
	SYSTEM_PROMPT as SYSTEM_PROMPT_SOVEREIGN,
	USER_PROMPT as USER_PROMPT_SOVEREIGN,
} from "./sovereign";
import {
	SYSTEM_PROMPT as SYSTEM_PROMPT_TRENDSURFER,
	USER_PROMPT as USER_PROMPT_TRENDSURFER,
} from "./trendsurfer";

export interface VariantConfig extends SharedVariantConfig {
	systemPrompt: string;
	userPrompt: string;
	temperature: number;
}

export const VARIANT_PROMPTS: Record<VariantId, VariantConfig> = {
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

export function getVariantConfig(variantId: VariantId): VariantConfig {
	const config = VARIANT_PROMPTS[variantId];
	if (!config) {
		throw new Error(`Unknown variant ID: ${variantId}`);
	}
	return config;
}

export function getAllVariants(): VariantConfig[] {
	return VARIANT_IDS.map((id) => VARIANT_PROMPTS[id]);
}
