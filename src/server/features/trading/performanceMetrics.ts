import { getPortfolioHistory } from "@/server/db/tradingRepository";
import {
	INITIAL_CAPITAL,
	calculateReturnPercent,
	calculateSharpeRatioFromPortfolio,
} from "@/core/shared/trading/calculations";
import type { Account } from "@/server/features/trading/accounts";

export type PerformanceMetrics = {
	sharpeRatio: string;
	totalReturnPercent: string;
};

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

	// Convert portfolio history to numeric values
	const portfolioValues = portfolioHistory
		.map((h) => parseFloat(h.netPortfolio))
		.filter((v) => Number.isFinite(v) && v > 0);

	// Use centralized Sharpe ratio calculation (1-minute intervals)
	const sharpeResult = calculateSharpeRatioFromPortfolio(portfolioValues, 1);

	return {
		sharpeRatio: sharpeResult.sharpeRatioFormatted,
		totalReturnPercent: `${totalReturn.toFixed(2)}%`,
	};
}
