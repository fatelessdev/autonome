import type { VariantId } from "@/server/features/trading/prompts/variants";

export interface Account {
	apiKey: string;
	name: string;
	modelName: string;
	invocationCount: number;
	id: string;
	accountIndex: string;
	totalMinutes: number;
	/** Strategy variant - determines which prompt set to use */
	variant?: VariantId;
}
