/**
 * Portfolio Snapshot Step
 *
 * Durable step that records portfolio snapshots for all models.
 * Automatically retries up to 3 times on failure.
 */
"use step";

import { recordPortfolios } from "@/server/features/portfolio/priceTracker";

export async function portfolioSnapshotStep() {
	await recordPortfolios();
	return { success: true };
}
