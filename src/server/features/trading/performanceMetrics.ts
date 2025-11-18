import { getPortfolioHistory } from "@/server/db/tradingRepository";
import type { Account } from "@/server/features/trading/accounts";

const INITIAL_CAPITAL = 10000;
const RISK_FREE_RATE = 0.04;

export type PerformanceMetrics = {
  sharpeRatio: string;
  totalReturnPercent: string;
};

export async function calculatePerformanceMetrics(
  account: Account,
  currentPortfolioValue: number,
) {
  const portfolioHistory = await getPortfolioHistory(account.id);

  if (portfolioHistory.length < 2) {
    return {
      sharpeRatio: "N/A (need more data)",
      totalReturnPercent: "N/A",
    } satisfies PerformanceMetrics;
  }

  const initialValue =
    parseFloat(portfolioHistory[0].netPortfolio) || INITIAL_CAPITAL;
  const totalReturn =
    ((currentPortfolioValue - initialValue) / initialValue) * 100;

  const returns: number[] = [];
  for (let i = 1; i < portfolioHistory.length; i++) {
    const prevValue = parseFloat(portfolioHistory[i - 1].netPortfolio);
    const currValue = parseFloat(portfolioHistory[i].netPortfolio);
    if (prevValue > 0) returns.push((currValue - prevValue) / prevValue);
  }

  if (returns.length < 2) {
    return {
      sharpeRatio: "N/A (need more data)",
      totalReturnPercent: `${totalReturn.toFixed(2)}%`,
    } satisfies PerformanceMetrics;
  }

  const meanReturn = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance =
    returns.reduce((s, r) => s + (r - meanReturn) ** 2, 0) /
    (returns.length - 1);
  const stdDev = Math.sqrt(variance);

  if (stdDev === 0 || returns.length < 30) {
    return {
      sharpeRatio: "N/A (insufficient data)",
      totalReturnPercent: `${totalReturn.toFixed(2)}%`,
    } satisfies PerformanceMetrics;
  }

  const periodsPerYear = (365 * 24 * 60) / 5;

  const annualizedReturn = (1 + meanReturn) ** periodsPerYear - 1;
  const annualizedStdDev = stdDev * Math.sqrt(periodsPerYear);

  if (annualizedStdDev < 0.0001) {
    return {
      sharpeRatio: "N/A (low volatility)",
      totalReturnPercent: `${totalReturn.toFixed(2)}%`,
    } satisfies PerformanceMetrics;
  }

  const sharpeRatio = (annualizedReturn - RISK_FREE_RATE) / annualizedStdDev;

  return {
    sharpeRatio: sharpeRatio.toFixed(3),
    totalReturnPercent: `${totalReturn.toFixed(2)}%`,
  } satisfies PerformanceMetrics;
}
