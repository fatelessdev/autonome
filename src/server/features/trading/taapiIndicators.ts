/**
 * TAAPI Supplementary Indicators
 * Pre-fetch BBands, ADX, Supertrend from TAAPI and format for prompt injection
 */

import {
	taapiClient,
	type TaapiPreFetchResult,
	type BBandsResult,
	type ADXResult,
	type SupertrendResult,
} from "@/server/integrations/taapi";

/**
 * Pre-fetch supplementary TAAPI indicators for all assets in a SINGLE API call.
 * Returns a map of asset -> TaapiPreFetchResult.
 *
 * Note: Free plan only supports BTC/USDT and ETH/USDT.
 * Other assets are automatically filtered out by the client.
 * These indicators use Binance data, not Lighter data.
 */
export async function preFetchTaapiIndicators(
	assets: string[],
	timeframe = "1h",
): Promise<Map<string, TaapiPreFetchResult>> {
	// Check if TAAPI is configured
	if (!taapiClient.isConfigured()) {
		console.log("[TAAPI] Not configured, skipping pre-fetch");
		return new Map();
	}

	// Use the new batch method that fetches ALL assets in ONE request
	// The client automatically filters to BTC/ETH only (free plan limitation)
	return taapiClient.preFetchMultipleAssets(assets, timeframe);
}

/**
 * Format a single indicator value for display
 */
const formatValue = (value: number | null | undefined, digits = 2): string => {
	if (value === null || value === undefined || !Number.isFinite(value)) {
		return "N/A";
	}
	return value.toFixed(digits);
};

/**
 * Format BBands result for prompt
 */
const formatBBands = (bbands: BBandsResult | null): string => {
	if (!bbands) return "Bollinger Bands: N/A";
	return `Bollinger Bands (20): Upper=${formatValue(bbands.valueUpperBand)}, Mid=${formatValue(bbands.valueMiddleBand)}, Lower=${formatValue(bbands.valueLowerBand)}`;
};

/**
 * Format ADX result for prompt
 * ADX interpretation:
 * - ADX < 20: Weak trend / ranging
 * - ADX 20-40: Trending
 * - ADX > 40: Strong trend
 */
const formatADX = (adx: ADXResult | null): string => {
	if (!adx || adx.value === undefined) return "ADX: N/A";

	let trendStrength: string;
	if (adx.value < 20) {
		trendStrength = "weak/ranging";
	} else if (adx.value < 40) {
		trendStrength = "trending";
	} else {
		trendStrength = "strong trend";
	}

	return `ADX(14): ${formatValue(adx.value, 1)} (${trendStrength})`;
};

/**
 * Format Supertrend result for prompt
 * Supertrend provides a clear signal: long or short
 */
const formatSupertrend = (supertrend: SupertrendResult | null): string => {
	if (!supertrend) return "Supertrend: N/A";

	const signal = supertrend.valueAdvice.toUpperCase();
	return `Supertrend: ${formatValue(supertrend.value)} | Signal: ${signal}`;
};

/**
 * Format TAAPI data for a single asset to inject into prompt.
 * Returns empty string if no data available.
 */
export function formatTaapiForPrompt(
	asset: string,
	data: TaapiPreFetchResult | undefined,
): string {
	if (!data) return "";

	// Check if all values are null (no data fetched)
	if (data.bbands === null && data.adx === null && data.supertrend === null) {
		return "";
	}

	const lines: string[] = [];
	lines.push(`## Supplementary Indicators (${asset}, Binance data)`);

	if (data.bbands) {
		lines.push(`- ${formatBBands(data.bbands)}`);
	}

	if (data.adx) {
		lines.push(`- ${formatADX(data.adx)}`);
	}

	if (data.supertrend) {
		lines.push(`- ${formatSupertrend(data.supertrend)}`);
	}

	return lines.join("\n");
}

/**
 * Format all TAAPI data for multiple assets to inject into prompt.
 */
export function formatAllTaapiForPrompt(
	taapiData: Map<string, TaapiPreFetchResult>,
): string {
	if (taapiData.size === 0) return "";

	const sections: string[] = [];

	for (const [asset, data] of taapiData) {
		const formatted = formatTaapiForPrompt(asset, data);
		if (formatted) {
			sections.push(formatted);
		}
	}

	if (sections.length === 0) return "";

	return (
		"\n\n## SUPPLEMENTARY TECHNICAL INDICATORS (TAAPI / Binance)\n" +
		"These indicators are calculated from Binance data for additional context.\n\n" +
		sections.join("\n\n")
	);
}
