import { getPortfolioHistory } from "@/server/db/tradingRepository";
import {
	INITIAL_CAPITAL,
	calculateReturnPercent,
	calculateSharpeRatioFromTrades,
	calculateWinRate,
	calculateMaxDrawdown,
	calculateCurrentDrawdown,
} from "@/core/shared/trading/calculations";
import type { Account } from "@/server/features/trading/accounts";
import { getClosedOrdersByModel, getTotalRealizedPnl } from "@/server/db/ordersRepository.server";

export type PerformanceMetrics = {
	sharpeRatio: string;
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
};

/**
 * Calculate Sharpe ratio from closed trades.
 * Uses the same trade-based approach as analytics for consistency.
 * This avoids the explosive per-minute compounding issue with portfolio-based Sharpe.
 */
async function calculateTradeSharpe(modelId: string): Promise<string> {
	const closedOrders = await getClosedOrdersByModel(modelId);

	if (closedOrders.length < 2) {
		return "N/A (need more trades)";
	}

	const pnls = closedOrders
		.map((order) => parseFloat(order.realizedPnl ?? "0"))
		.filter((pnl) => Number.isFinite(pnl));

	if (pnls.length < 2) {
		return "N/A (need more trades)";
	}

	const sharpe = calculateSharpeRatioFromTrades(pnls);

	// Guard against extreme values (shouldn't happen with trade-based, but be safe)
	if (!Number.isFinite(sharpe) || Math.abs(sharpe) > 100) {
		return "N/A (insufficient data)";
	}

	return sharpe.toFixed(2);
}

export async function calculatePerformanceMetrics(
	account: Account,
	currentPortfolioValue: number,
): Promise<PerformanceMetrics> {
	const [portfolioHistory, closedTradeRealizedPnl, closedOrders] = await Promise.all([
		getPortfolioHistory(account.id),
		getTotalRealizedPnl(account.id),
		getClosedOrdersByModel(account.id),
	]);

	// Calculate trade stats
	const tradeCount = closedOrders.length;
	const pnls = closedOrders
		.map((order) => parseFloat(order.realizedPnl ?? "0"))
		.filter((pnl) => Number.isFinite(pnl));
	const winRate = tradeCount > 0 
		? `${calculateWinRate(pnls).toFixed(1)}%` 
		: "N/A";

	// Calculate drawdown from portfolio history
	const portfolioValues = portfolioHistory
		.map((h) => parseFloat(h.netPortfolio))
		.filter((v) => Number.isFinite(v));
	const currentDrawdown = portfolioValues.length > 0
		? `${calculateCurrentDrawdown(portfolioValues).toFixed(1)}%`
		: "0.0%";
	const maxDrawdown = portfolioValues.length > 1
		? `${calculateMaxDrawdown(portfolioValues).toFixed(1)}%`
		: "0.0%";

	if (portfolioHistory.length < 2) {
		return {
			sharpeRatio: "N/A (need more data)",
			totalReturnPercent: "N/A",
			closedTradeRealizedPnl,
			tradeCount,
			winRate,
			currentDrawdown,
			maxDrawdown,
		};
	}

	const initialValue =
		parseFloat(portfolioHistory[0].netPortfolio) || INITIAL_CAPITAL;
	const totalReturn = calculateReturnPercent(currentPortfolioValue, initialValue);

	// Use trade-based Sharpe ratio (same as analytics) for consistency
	// This avoids the explosive per-minute compounding issue
	const sharpeRatio = await calculateTradeSharpe(account.id);

	return {
		sharpeRatio,
		totalReturnPercent: `${totalReturn.toFixed(2)}%`,
		closedTradeRealizedPnl,
		tradeCount,
		winRate,
		currentDrawdown,
		maxDrawdown,
	};
}
