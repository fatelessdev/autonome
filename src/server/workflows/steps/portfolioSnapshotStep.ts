"use step";

import { recordPortfolios } from "@/server/features/portfolio/priceTracker";

export async function portfolioSnapshotStep() {
	await recordPortfolios();
	return { success: true };
}
