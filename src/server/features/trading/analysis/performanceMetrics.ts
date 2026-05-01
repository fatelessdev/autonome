import {
	calculateCurrentDrawdown,
	calculateMaxDrawdown,
	calculateRecoveryFactor,
	calculateReturnPercent,
	calculateWinRate,
	tradeSignalToNoiseRatio,
} from "@/core/shared/trading/calculations";
import type { Order } from "@/db/schema";
import { getClosedOrdersByModel } from "@/server/db/ordersRepository.server";
import {
	calculateDecisionQualityScore,
	calculateDurationDistribution,
	calculateProfitFactor,
	calculateRMultiple,
	calculateStreaks,
} from "@/server/features/analytics/calculations";
import type { ClosedTradeData } from "@/server/features/analytics/types";
import { getSharpeRatio } from "@/server/features/portfolio/welfordService";
import type { Account } from "@/server/features/trading/contracts/accounts";
import { getTradingProvider } from "@/server/providers/alpaca";

export type PerformanceMetrics = {
	/** Trade-level signal-to-noise ratio (non-annualized, from closed trade P&Ls) */
	tradeSignalToNoise: string;
	/** Sharpe ratio computed via Welford's online algorithm from portfolio returns */
	welfordSharpeRatio: string;
	totalReturnPercent: string;
	/** Realized P&L from all closed trades (historical) */
	closedTradeRealizedPnl: number;
	/** Number of completed trades */
	tradeCount: number;
	/** Win rate as percentage string (e.g., "65.0%") */
	winRate: string;
	/** Current drawdown from peak as percentage string (e.g., "5.2%") */
	currentDrawdown: string;
	/** Maximum historical drawdown as percentage string (e.g., "12.3%") */
	maxDrawdown: string;
	/** Recovery factor = net profit / max absolute drawdown */
	recoveryFactor: string;
	/** Profit factor: sum(wins) / abs(sum(losses)). "N/A" when no trades. */
	profitFactor: string;
	/** Average R-Multiple: mean(wins) / abs(mean(losses)). "N/A" when no trades. */
	avgRMultiple: string;
	/** Decision Quality Score: Pearson correlation confidence vs P&L. "N/A" when <3 trades. */
	decisionQualityScore: string;
	/** Longest consecutive win streak */
	longestWinStreak: number;
	/** Longest consecutive loss streak */
	longestLossStreak: number;
	/** Current streak count */
	currentStreakCount: number;
	/** Current streak type: "win", "loss", or "none" */
	currentStreakType: "win" | "loss" | "none";
	/** Average hold time for winning trades in minutes */
	avgWinDurationMinutes: string;
	/** Average hold time for losing trades in minutes */
	avgLossDurationMinutes: string;
};

const parseRequiredRealizedPnl = (
	value: string | null,
	orderId: string,
): number => {
	if (value == null) {
		throw new Error(`Closed order ${orderId} is missing realizedPnl`);
	}
	const parsed = Number.parseFloat(value);
	if (!Number.isFinite(parsed)) {
		throw new Error(
			`Closed order ${orderId} has invalid realizedPnl: ${value}`,
		);
	}
	return parsed;
};

/**
 * Convert DB Order to ClosedTradeData for analytics pure functions.
 * Skips orders missing required timestamps.
 */
function orderToClosedTradeData(order: Order): ClosedTradeData | null {
	if (!order.closedAt || !order.openedAt) return null;
	const exitPlan = order.exitPlan as
		| { confidence?: number | null }
		| null
		| undefined;
	return {
		modelId: order.modelId,
		symbol: order.symbol,
		side: order.side as "LONG" | "SHORT",
		quantity: Number(order.quantity),
		entryPrice: Number(order.entryPrice),
		exitPrice: Number(order.exitPrice ?? order.entryPrice),
		realizedPnl: parseRequiredRealizedPnl(order.realizedPnl, order.id),
		confidence: exitPlan?.confidence ?? null,
		openedAt: order.openedAt,
		closedAt: order.closedAt,
	};
}

/**
 * Format profit factor for prompt display.
 */
function formatProfitFactor(
	pf: number | "N/A" | typeof Number.POSITIVE_INFINITY,
): string {
	if (pf === "N/A") return "N/A";
	if (!Number.isFinite(pf as number)) return "Infinity";
	return (pf as number).toFixed(2);
}

/**
 * Format R-multiple for prompt display.
 */
function formatRMultiple(
	rm: number | "N/A" | typeof Number.POSITIVE_INFINITY,
): string {
	if (rm === "N/A") return "N/A";
	if (!Number.isFinite(rm as number)) return "Infinity";
	return (rm as number).toFixed(2);
}

/**
 * Calculate trade signal-to-noise ratio and total realized P&L from the same
 * closed-orders query. Avoids querying the orders table three separate times.
 */
function calculateTradeStatsFromOrders(closedOrders: Order[]): {
	tradeSignalToNoise: string;
	closedTradeRealizedPnl: number;
	tradeCount: number;
	winRate: string;
	profitFactor: string;
	avgRMultiple: string;
	decisionQualityScore: string;
	longestWinStreak: number;
	longestLossStreak: number;
	currentStreakCount: number;
	currentStreakType: "win" | "loss" | "none";
	avgWinDurationMinutes: string;
	avgLossDurationMinutes: string;
} {
	const pnls = closedOrders.map((order) =>
		parseRequiredRealizedPnl(order.realizedPnl, order.id),
	);
	const closedTradeRealizedPnl = pnls.reduce((sum, pnl) => sum + pnl, 0);
	const tradeCount = closedOrders.length;
	const winRate =
		tradeCount > 0 ? `${calculateWinRate(pnls).toFixed(1)}%` : "N/A";

	let tradeSignalToNoise: string;
	if (pnls.length < 2) {
		tradeSignalToNoise = "N/A (need more trades)";
	} else {
		const ratio = tradeSignalToNoiseRatio(pnls);
		tradeSignalToNoise =
			Number.isFinite(ratio) && Math.abs(ratio) <= 100
				? ratio.toFixed(2)
				: "N/A (insufficient data)";
	}

	// Convert to ClosedTradeData for pure analytics functions
	const trades = closedOrders
		.map(orderToClosedTradeData)
		.filter((t): t is ClosedTradeData => t !== null);

	const profitFactor = formatProfitFactor(calculateProfitFactor(pnls));
	const avgRMultiple = formatRMultiple(calculateRMultiple(pnls));
	const decisionQuality = calculateDecisionQualityScore(trades);
	const decisionQualityScore =
		decisionQuality === "N/A" ? "N/A" : (decisionQuality as number).toFixed(3);
	const streaks = calculateStreaks(trades);
	const durationDist = calculateDurationDistribution(trades);

	return {
		tradeSignalToNoise,
		closedTradeRealizedPnl,
		tradeCount,
		winRate,
		profitFactor,
		avgRMultiple,
		decisionQualityScore,
		avgWinDurationMinutes:
			durationDist.avgWinDurationMinutes > 0
				? `${Math.round(durationDist.avgWinDurationMinutes)}m`
				: "N/A",
		avgLossDurationMinutes:
			durationDist.avgLossDurationMinutes > 0
				? `${Math.round(durationDist.avgLossDurationMinutes)}m`
				: "N/A",
		...streaks,
	};
}

export async function calculatePerformanceMetrics(
	account: Account,
	currentPortfolioValue: number,
): Promise<PerformanceMetrics> {
	const trading = getTradingProvider(
		account.alpacaApiKey,
		account.alpacaApiSecret,
	);

	// Single DB query for closed orders (replaces 2 separate queries: getTotalRealizedPnl + getClosedOrdersByModel)
	const [alpacaHistory, closedOrders] = await Promise.all([
		trading.getPortfolioHistory({
			period: "1M",
			timeframe: "1D",
			intraday_reporting: "continuous",
		}),
		getClosedOrdersByModel(account.id),
	]);

	const {
		tradeSignalToNoise,
		closedTradeRealizedPnl,
		tradeCount,
		winRate,
		profitFactor,
		avgRMultiple,
		decisionQualityScore,
		avgWinDurationMinutes,
		avgLossDurationMinutes,
		longestWinStreak,
		longestLossStreak,
		currentStreakCount,
		currentStreakType,
	} = calculateTradeStatsFromOrders(closedOrders);

	// Calculate drawdown from portfolio history
	const portfolioValues = alpacaHistory.equity.filter(Number.isFinite);
	const currentDrawdown =
		portfolioValues.length > 0
			? `${calculateCurrentDrawdown(portfolioValues).toFixed(1)}%`
			: "N/A";
	const maxDrawdown =
		portfolioValues.length > 1
			? `${calculateMaxDrawdown(portfolioValues).toFixed(1)}%`
			: "N/A";
	const recoveryFactor =
		portfolioValues.length > 1
			? calculateRecoveryFactor(portfolioValues).toFixed(2)
			: "N/A";

	// Get Welford-based Sharpe ratio (online algorithm from portfolio returns)
	const welfordResult = getSharpeRatio(account.id);
	const welfordSharpeRatio = welfordResult.isValid
		? welfordResult.sharpeRatio.toFixed(3)
		: (welfordResult.reason ?? "N/A");

	if (portfolioValues.length < 2) {
		if (alpacaHistory.base_value == null) {
			throw new Error(
				`Portfolio history missing base_value for model ${account.id}`,
			);
		}
		const fallbackReturn = calculateReturnPercent(
			currentPortfolioValue,
			alpacaHistory.base_value,
		);

		return {
			tradeSignalToNoise: "N/A (need more data)",
			welfordSharpeRatio,
			totalReturnPercent: `${fallbackReturn.toFixed(2)}%`,
			closedTradeRealizedPnl,
			tradeCount,
			winRate,
			currentDrawdown,
			maxDrawdown,
			recoveryFactor,
			profitFactor,
			avgRMultiple,
			decisionQualityScore,
			longestWinStreak,
			longestLossStreak,
			currentStreakCount,
			currentStreakType,
			avgWinDurationMinutes,
			avgLossDurationMinutes,
		};
	}

	const profitLossPct = alpacaHistory.profit_loss_pct;
	const totalReturn =
		profitLossPct.length > 0
			? profitLossPct[profitLossPct.length - 1] * 100
			: calculateReturnPercent(
					currentPortfolioValue,
					alpacaHistory.base_value == null
						? (() => {
								throw new Error(
									`Portfolio history missing base_value for model ${account.id}`,
								);
							})()
						: alpacaHistory.base_value,
				);

	return {
		tradeSignalToNoise,
		welfordSharpeRatio,
		totalReturnPercent: `${totalReturn.toFixed(2)}%`,
		closedTradeRealizedPnl,
		tradeCount,
		winRate,
		currentDrawdown,
		maxDrawdown,
		recoveryFactor,
		profitFactor,
		avgRMultiple,
		decisionQualityScore,
		longestWinStreak,
		longestLossStreak,
		currentStreakCount,
		currentStreakType,
		avgWinDurationMinutes,
		avgLossDurationMinutes,
	};
}
