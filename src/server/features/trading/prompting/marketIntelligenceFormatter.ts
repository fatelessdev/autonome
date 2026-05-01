/**
 * Market Intelligence Formatter
 *
 * Converts structured market intelligence data into formatted prompt strings.
 * Separated from the cache layer to maintain single responsibility:
 * cache handles fetching/caching, formatter handles prompt string generation.
 */

import type { OpenInterestMap } from "@/server/integrations/binance-oi";
import type { TaapiPreFetchResult } from "@/server/integrations/taapi";
import { TAAPI_FREE_PLAN_SYMBOLS } from "@/server/integrations/taapi/types";
import { formatMarketSnapshots, type MarketSnapshot } from "../data/marketData";

/**
 * Format TAAPI supplementary indicators for a symbol.
 * Returns formatted string section or empty string if no data.
 */
function formatTaapiIndicators(
	_symbol: string,
	data: TaapiPreFetchResult | undefined,
	currentPrice?: number,
): string {
	if (!data) return "";

	const lines: string[] = [];
	lines.push(`**Supplementary Indicators (1h, via TAAPI)**`);

	if (data.bbands) {
		lines.push(
			`BBands(20): Upper=${data.bbands.valueUpperBand.toFixed(2)}, ` +
				`Mid=${data.bbands.valueMiddleBand.toFixed(2)}, ` +
				`Lower=${data.bbands.valueLowerBand.toFixed(2)}`,
		);
	}

	if (data.adx) {
		const strength =
			data.adx.value >= 25
				? "strong trend"
				: data.adx.value >= 20
					? "moderate trend"
					: "weak/no trend";
		lines.push(`ADX(14): ${data.adx.value.toFixed(1)} (${strength})`);
	}

	if (data.supertrend) {
		lines.push(
			`Supertrend(10): ${data.supertrend.value.toFixed(2)} → ${data.supertrend.valueAdvice.toUpperCase()}`,
		);
	}

	// Ichimoku Cloud - key levels and cloud status
	if (data.ichimoku) {
		const ich = data.ichimoku;
		lines.push(
			`Ichimoku: Tenkan=${ich.conversion.toFixed(2)}, Kijun=${ich.base.toFixed(2)}`,
		);
		lines.push(
			`  Cloud: SpanA=${ich.spanA.toFixed(2)}, SpanB=${ich.spanB.toFixed(2)}`,
		);

		// Determine cloud status if we have current price
		if (currentPrice !== undefined && currentPrice !== null) {
			const cloudTop = Math.max(ich.spanA, ich.spanB);
			const cloudBottom = Math.min(ich.spanA, ich.spanB);

			let cloudStatus: string;
			if (currentPrice > cloudTop) {
				cloudStatus = "ABOVE CLOUD (Bullish)";
			} else if (currentPrice < cloudBottom) {
				cloudStatus = "BELOW CLOUD (Bearish)";
			} else {
				cloudStatus = "INSIDE CLOUD (Choppy/Neutral)";
			}
			lines.push(`  Cloud Status: ${cloudStatus}`);
		}
	}

	// VWAP - Volume Weighted Average Price
	if (data.vwap && data.vwap.value !== undefined) {
		let vwapStatus = "";
		if (currentPrice !== undefined && currentPrice !== null) {
			const diff = currentPrice - data.vwap.value;
			const diffPct = (diff / data.vwap.value) * 100;
			if (currentPrice > data.vwap.value) {
				vwapStatus = ` | Price > VWAP (+${diffPct.toFixed(2)}%, Bullish)`;
			} else {
				vwapStatus = ` | Price < VWAP (${diffPct.toFixed(2)}%, Bearish)`;
			}
		}
		lines.push(`VWAP: ${data.vwap.value.toFixed(2)}${vwapStatus}`);
	}

	// If no indicators were added, return empty
	if (lines.length === 1) return "";

	return lines.join("\n");
}

/**
 * Format open interest data for a symbol.
 * Returns formatted string section or empty string if no data.
 */
function formatOpenInterest(
	symbol: string,
	oiData: OpenInterestMap | undefined,
): string {
	if (!oiData) return "";

	const data = oiData.get(symbol);
	if (!data) return "";

	const lines: string[] = [];
	lines.push(`**Open Interest (via Binance Futures)**`);

	// Format OI value in human-readable form (contracts)
	const oiFormatted =
		data.openInterest >= 1_000_000
			? `${(data.openInterest / 1_000_000).toFixed(2)}M`
			: data.openInterest >= 1_000
				? `${(data.openInterest / 1_000).toFixed(2)}K`
				: data.openInterest.toFixed(2);

	// Format OI value in USD
	const oiUsdFormatted =
		data.openInterestValueUsd >= 1_000_000_000
			? `$${(data.openInterestValueUsd / 1_000_000_000).toFixed(2)}B`
			: data.openInterestValueUsd >= 1_000_000
				? `$${(data.openInterestValueUsd / 1_000_000).toFixed(2)}M`
				: `$${(data.openInterestValueUsd / 1_000).toFixed(2)}K`;

	lines.push(`OI: ${oiFormatted} contracts (${oiUsdFormatted})`);

	// Format change with direction indicator
	const changeSign = data.changePercent >= 0 ? "+" : "";
	lines.push(`OI 24h Change: ${changeSign}${data.changePercent.toFixed(2)}%`);

	return lines.join("\n");
}

/**
 * Format structured market intelligence data into a prompt string.
 * Combines market snapshots, TAAPI indicators, and open interest data.
 */
export function formatMarketIntelligence(data: {
	snapshots: MarketSnapshot[];
	taapiData: Map<string, TaapiPreFetchResult>;
	oiData: OpenInterestMap;
}): string {
	let formatted = formatMarketSnapshots(data.snapshots);

	// Build a price map from snapshots for TAAPI formatting
	const priceMap = new Map<string, number>();
	for (const snapshot of data.snapshots) {
		if (snapshot.latest.price && Number.isFinite(snapshot.latest.price)) {
			priceMap.set(snapshot.symbol, snapshot.latest.price);
		}
	}

	// Append TAAPI data for BTC/ETH if available
	for (const symbol of TAAPI_FREE_PLAN_SYMBOLS) {
		const taapiIndicators = data.taapiData.get(symbol);
		if (taapiIndicators) {
			const currentPrice = priceMap.get(symbol);
			const taapiSection = formatTaapiIndicators(
				symbol,
				taapiIndicators,
				currentPrice,
			);
			if (taapiSection) {
				// Insert TAAPI section after the symbol's market data header
				const marker = `### ${symbol} MARKET DATA`;
				const markerIndex = formatted.indexOf(marker);
				if (markerIndex !== -1) {
					// Find the end of the first line (after the header)
					const lineEnd = formatted.indexOf("\n", markerIndex);
					if (lineEnd !== -1) {
						// Insert TAAPI section before the series data
						const higherTfMarker = "**Higher timeframe (4h";
						const higherTfIndex = formatted.indexOf(
							higherTfMarker,
							markerIndex,
						);
						if (higherTfIndex !== -1) {
							formatted =
								formatted.slice(0, higherTfIndex) +
								taapiSection +
								"\n" +
								formatted.slice(higherTfIndex);
						}
					}
				}
			}
		}
	}

	// Append OI data for all symbols that have it
	if (data.oiData.size > 0) {
		for (const [symbol] of data.oiData) {
			const oiSection = formatOpenInterest(symbol, data.oiData);
			if (oiSection) {
				const marker = `### ${symbol} MARKET DATA`;
				const markerIndex = formatted.indexOf(marker);
				if (markerIndex !== -1) {
					// Insert OI section after TAAPI section (if present) or before series data
					const higherTfMarker = "**Higher timeframe (4h";
					const higherTfIndex = formatted.indexOf(higherTfMarker, markerIndex);
					if (higherTfIndex !== -1) {
						formatted =
							formatted.slice(0, higherTfIndex) +
							oiSection +
							"\n" +
							formatted.slice(higherTfIndex);
					}
				}
			}
		}
	}

	return formatted;
}
