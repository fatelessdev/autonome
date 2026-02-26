/**
 * Retention Policy Step
 *
 * Durable step that downsamples old portfolio data.
 * Runs periodically (not every cycle) to aggregate
 * minute-level data into hourly/daily buckets.
 */
"use step";

import { runRetentionPolicyJob } from "@/server/features/portfolio/priceTracker";

export async function retentionPolicyStep() {
	await runRetentionPolicyJob();
	return { success: true };
}
