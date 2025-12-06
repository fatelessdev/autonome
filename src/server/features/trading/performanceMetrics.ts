import { getPortfolioHistory } from "@/server/db/tradingRepository";
import {
	INITIAL_CAPITAL,
	calculateReturnPercent,
	calculateSharpeRatioFromTrades,
} from "@/core/shared/trading/calculations";
import type { Account } from "@/server/features/trading/accounts";
import { getClosedOrdersByModel } from "@/server/db/ordersRepository.server";

export type PerformanceMetrics = {
	sharpeRatio: string;
	totalReturnPercent: string;
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
	const portfolioHistory = await getPortfolioHistory(account.id);

	if (portfolioHistory.length < 2) {
		return {
			sharpeRatio: "N/A (need more data)",
			totalReturnPercent: "N/A",
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
	};
}
