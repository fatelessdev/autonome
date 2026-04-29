/**
 * Shared Trading Decision Types
 *
 * These interfaces represent the shape of trading decisions and results
 * used across the UI and server. They are intentionally kept in core/shared
 * so that dashboardTypes and UI code can import them without reaching into
 * the server layer.
 */

export type TradingSide = "LONG" | "SHORT" | "HOLD";

export interface TradingDecision {
	symbol: string;
	side: TradingSide;
	quantity: number | null;
	leverage: number | null;
	profitTarget: number | null;
	stopLoss: number | null;
	invalidationCondition: string | null;
	invalidationPrice: number | null;
	timeExit: string | null;
	cooldownUntil: string | null;
	confidence: number | null;
	status?: string | null;
}

export interface TradingDecisionResult {
	symbol: string;
	success: boolean;
	error?: string | null;
}
