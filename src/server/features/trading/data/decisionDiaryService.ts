/**
 * Decision Diary Service
 *
 * Handles writing DecisionDiary entries (per-invocation) and MarketState entries
 * (per-cycle) after trade execution. Extracts structured data from the existing
 * market intelligence cache and trade workflow context.
 */

import {
	createDecisionDiaryEntry,
	createMarketStateEntry,
} from "@/server/db/tradingRepository";
import type {
	CorrelationMatrix,
	CorrelationPair,
} from "@/server/features/trading/analysis/correlationMatrix";
import type { InvocationDecisionSummary } from "@/server/features/trading/contracts/invocationResponse";
import type { MarketSnapshot } from "@/server/features/trading/data/marketData";
import type { OpenInterestMap } from "@/server/integrations/binance-oi";
import type { TaapiPreFetchResult } from "@/server/integrations/taapi/types";

// ==========================================
// Regime classification from ADX
// ==========================================

function classifyRegime(adxValue: number): "trending" | "ranging" | "choppy" {
	if (adxValue >= 25) return "trending";
	if (adxValue >= 20) return "ranging";
	return "choppy";
}

// ==========================================
// ADX extraction from TAAPI data
// ==========================================

function getAdxFromTaapi(
	taapiData: Map<string, TaapiPreFetchResult>,
): number | null {
	// Use BTC as the primary ADX source (most relevant for crypto regime)
	const btc = taapiData.get("BTC");
	if (btc?.adx?.value != null) return btc.adx.value;

	// Fallback to any available ADX
	for (const [, data] of taapiData) {
		if (data.adx?.value != null) return data.adx.value;
	}
	return null;
}

// ==========================================
// BBands position extraction
// ==========================================

function getBbandsPosition(
	taapiData: Map<string, TaapiPreFetchResult>,
): "upper" | "middle" | "lower" | null {
	const btc = taapiData.get("BTC");
	if (!btc?.bbands) return null;

	// Use middle band as reference. Without live price, we classify position
	// based on the relationship between bands. This is intentionally coarse
	// for the diary — the prompt gets the real-time classification.
	const upper = btc.bbands.valueUpperBand;
	const lower = btc.bbands.valueLowerBand;
	const mid = btc.bbands.valueMiddleBand;

	// Approximate: if mid is closer to upper, market is near upper band
	const range = upper - lower;
	if (range === 0) return "middle";

	const midPosition = (mid - lower) / range;
	if (midPosition >= 0.7) return "upper";
	if (midPosition <= 0.3) return "lower";
	return "middle";
}

// ==========================================
// Supertrend direction extraction
// ==========================================

function getSupertrendDirection(
	taapiData: Map<string, TaapiPreFetchResult>,
): "long" | "short" | null {
	const btc = taapiData.get("BTC");
	if (!btc?.supertrend) return null;
	return btc.supertrend.valueAdvice === "long" ? "long" : "short";
}

// ==========================================
// Top movers from market snapshots
// ==========================================

function getTopMovers(
	snapshots: MarketSnapshot[],
): Array<{ symbol: string; changePct: number }> {
	const movers: Array<{ symbol: string; changePct: number }> = [];

	for (const snapshot of snapshots) {
		const { series } = snapshot;
		const prices = series.intraday.midPrices;
		if (prices.length < 2) continue;

		const first = prices[0];
		const last = prices[prices.length - 1];
		if (!first || !last || first === 0) continue;

		const changePct = ((last - first) / first) * 100;
		if (Number.isFinite(changePct)) {
			movers.push({ symbol: snapshot.symbol, changePct });
		}
	}

	// Sort by absolute change descending, return top 5
	movers.sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));
	return movers.slice(0, 5);
}

// ==========================================
// Active correlations extraction
// ==========================================

function getActiveCorrelations(
	correlationMatrix: CorrelationMatrix,
): Array<{ symbolA: string; symbolB: string; correlation: number }> {
	return correlationMatrix.pairs
		.filter((pair: CorrelationPair) => Math.abs(pair.correlation) >= 0.8)
		.map((pair: CorrelationPair) => ({
			symbolA: pair.symbolA,
			symbolB: pair.symbolB,
			correlation: pair.correlation,
		}));
}

// ==========================================
// Open interest summary extraction
// ==========================================

function getOpenInterestSummary(oiData: OpenInterestMap): Array<{
	symbol: string;
	openInterest: number;
	openInterestValueUsd: number;
	changePercent: number;
}> | null {
	if (oiData.size === 0) return null;

	return Array.from(oiData.entries()).map(([symbol, data]) => ({
		symbol,
		openInterest: data.openInterest,
		openInterestValueUsd: data.openInterestValueUsd,
		changePercent: data.changePercent,
	}));
}

// ==========================================
// DecisionDiary write
// ==========================================

/**
 * Write a DecisionDiary entry after an invocation completes.
 * Extracts structured data from the invocation's decision summaries,
 * market intelligence cache, and portfolio state.
 */
export async function writeDecisionDiaryEntry(params: {
	modelId: string;
	invocationId: string;
	variant: "Trendsurfer" | "Contrarian" | "Sovereign";
	decisions: InvocationDecisionSummary[];
	marketSnapshots: MarketSnapshot[];
	taapiData: Map<string, TaapiPreFetchResult>;
	correlationMatrix: CorrelationMatrix;
	portfolioValue: number;
	cash: number;
	exposurePct: number;
	openPositionsCount: number;
}): Promise<void> {
	const adx = getAdxFromTaapi(params.taapiData);
	const regime = adx != null ? classifyRegime(adx) : null;

	const diaryDecisions = params.decisions.map((d) => ({
		symbol: d.symbol,
		side: d.side,
		confidence: d.confidence,
		reasoningSummary: null as string | null,
	}));

	await createDecisionDiaryEntry({
		modelId: params.modelId,
		invocationId: params.invocationId,
		variant: params.variant,
		decisions: diaryDecisions,
		marketSnapshot: {
			adx,
			regime,
			bbandsPosition: getBbandsPosition(params.taapiData),
			supertrendDirection: getSupertrendDirection(params.taapiData),
		},
		modelState: {
			cash: params.cash,
			exposurePct: params.exposurePct,
			portfolioValue: params.portfolioValue,
			openPositionsCount: params.openPositionsCount,
		},
	});
}

// ==========================================
// MarketState write
// ==========================================

/**
 * Write a MarketState entry after a trade cycle completes.
 * One entry per model capturing the market regime and context.
 */
export async function writeMarketStateEntry(params: {
	modelId: string;
	marketSnapshots: MarketSnapshot[];
	taapiData: Map<string, TaapiPreFetchResult>;
	correlationMatrix: CorrelationMatrix;
	oiData: OpenInterestMap;
}): Promise<void> {
	const adx = getAdxFromTaapi(params.taapiData);
	// When ADX is null (no data), default to null regime (UNKNOWN) rather than
	// 0 which would classify as a specific regime.
	const regime = adx != null ? classifyRegime(adx) : null;

	await createMarketStateEntry({
		modelId: params.modelId,
		regime,
		adxValue: adx != null ? adx.toFixed(2) : null,
		topMovers: getTopMovers(params.marketSnapshots),
		activeCorrelations: getActiveCorrelations(params.correlationMatrix),
		openInterestSummary: getOpenInterestSummary(params.oiData),
	});
}
