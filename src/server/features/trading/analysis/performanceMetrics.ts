import {
	calculateCurrentDrawdown,
	calculateMaxDrawdown,
	calculateReturnPercent,
	calculateSharpeRatioFromTrades,
	calculateWinRate,
	INITIAL_CAPITAL,
} from "@/core/shared/trading/calculations";
import {
	getClosedOrdersByModel,
	getTotalRealizedPnl,
} from "@/server/db/ordersRepository.server";
import type { Account } from "@/server/features/trading/contracts/accounts";
import { getTradingProvider } from "@/server/providers/alpaca";

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
	const trading = getTradingProvider(
		account.alpacaApiKey,
		account.alpacaApiSecret,
	);

	const [alpacaHistory, closedTradeRealizedPnl, closedOrders] =
		await Promise.all([
			trading.getPortfolioHistory({
				period: "1M",
				timeframe: "1D",
				intraday_reporting: "continuous",
			}),
			getTotalRealizedPnl(account.id),
			getClosedOrdersByModel(account.id),
		]);

	// Calculate trade stats
	const tradeCount = closedOrders.length;
	const pnls = closedOrders
		.map((order) => parseFloat(order.realizedPnl ?? "0"))
		.filter((pnl) => Number.isFinite(pnl));
	const winRate =
		tradeCount > 0 ? `${calculateWinRate(pnls).toFixed(1)}%` : "N/A";

	// Calculate drawdown from portfolio history
	const portfolioValues = alpacaHistory.equity.filter(Number.isFinite);
	const currentDrawdown =
		portfolioValues.length > 0
			? `${calculateCurrentDrawdown(portfolioValues).toFixed(1)}%`
			: "0.0%";
	const maxDrawdown =
		portfolioValues.length > 1
			? `${calculateMaxDrawdown(portfolioValues).toFixed(1)}%`
			: "0.0%";

	if (portfolioValues.length < 2) {
		const fallbackInitial = alpacaHistory.base_value || INITIAL_CAPITAL;
		const fallbackReturn = calculateReturnPercent(
			currentPortfolioValue,
			fallbackInitial,
		);

		return {
			sharpeRatio: "N/A (need more data)",
			totalReturnPercent: `${fallbackReturn.toFixed(2)}%`,
			closedTradeRealizedPnl,
			tradeCount,
			winRate,
			currentDrawdown,
			maxDrawdown,
		};
	}

	const profitLossPct = alpacaHistory.profit_loss_pct;
	const totalReturn =
		profitLossPct.length > 0
			? profitLossPct[profitLossPct.length - 1] * 100
			: calculateReturnPercent(
					currentPortfolioValue,
					alpacaHistory.base_value || INITIAL_CAPITAL,
				);

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
