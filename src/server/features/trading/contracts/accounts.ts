import type { VariantId } from "@/core/shared/variants";

export interface Account {
	alpacaApiKey: string;
	alpacaApiSecret: string;
	name: string;
	modelName: string;
	invocationCount: number;
	id: string;
	totalMinutes: number;
	/** Strategy variant - determines which prompt set to use */
	variant: VariantId;
}
