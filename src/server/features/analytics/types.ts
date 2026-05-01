/**
 * Analytics Types - Trading statistics for model performance analysis
 */

// Re-export canonical StepTelemetry so analytics consumers get it from one place
// without duplicating the interface definition.
import type { StepTelemetry } from "@/server/features/trading/contracts/invocationResponse";
export type { StepTelemetry };

export interface OverallStats {
	modelId: string;
	modelName: string;
	variant?: string;
	accountValue: number;
	returnPercent: number;
	totalPnl: number;
	winRate: number;
	biggestWin: number;
	biggestLoss: number;
	/** Trade-level signal-to-noise ratio (non-annualized, from closed trade P&Ls) */
	tradeSignalToNoise: number;
	tradesCount: number;
}

export interface AdvancedStats {
	modelId: string;
	modelName: string;
	variant?: string;
	accountValue: number;
	avgTradeSize: number;
	medianTradeSize: number;
	maxTradeSize: number;
	avgHoldTimeMinutes: number;
	medianHoldTimeMinutes: number;
	maxHoldTimeMinutes: number;
	longPercent: number;
	expectancy: number;
	recoveryFactor: number;
	avgConfidence: number;
	medianConfidence: number;
	maxConfidence: number;
	// Failure metrics
	failedWorkflowCount: number;
	failedToolCallCount: number;
	/** Number of unique failed invocations (an invocation with both failure types counts once) */
	failedCount: number;
	invocationCount: number;
	failureRate: number;
	// New analytics metrics
	/** Sum(wins) / abs(sum(losses)). Infinity when no losses, 0 when no wins, "N/A" when no trades */
	profitFactor: number | "Infinity" | "N/A";
	/** Mean(wins) / abs(mean(losses)). Same edge cases as profitFactor */
	avgRMultiple: number | "Infinity" | "N/A";
	/** Pearson correlation between confidence and realizedPnl. "N/A" when <3 tagged trades */
	decisionQualityScore: number | "N/A";
	/** Annualized return / downside deviation. "N/A" when insufficient data */
	sortinoRatio: number | "N/A";
	/** Total return % / max drawdown %. "N/A" when no drawdown */
	calmarRatio: number | "N/A";
	/** Longest consecutive win streak */
	longestWinStreak: number;
	/** Longest consecutive loss streak */
	longestLossStreak: number;
	/** Current streak count */
	currentStreakCount: number;
	/** Current streak type: "win", "loss", or "none" */
	currentStreakType: "win" | "loss" | "none";
	/** Average hold time for winning trades in minutes */
	avgWinDurationMinutes: number;
	/** Average hold time for losing trades in minutes */
	avgLossDurationMinutes: number;
}

export interface ModelAnalytics {
	overall: OverallStats;
	advanced: AdvancedStats;
}

export interface ClosedTradeData {
	modelId: string;
	symbol: string;
	side: "LONG" | "SHORT";
	quantity: number;
	entryPrice: number;
	exitPrice: number;
	realizedPnl: number;
	confidence: number | null;
	openedAt: Date;
	closedAt: Date;
}

// Leaderboard types
export type LeaderboardWindow = "24h" | "7d" | "30d";
export type LeaderboardSortKey = "pnlPercent" | "pnlAbsolute" | "maxDrawdown";

export interface LeaderboardEntry {
	modelId: string;
	modelName: string;
	variant: string;
	pnlPercent: number;
	pnlAbsolute: number;
	maxDrawdown: number;
	startValue: number;
	endValue: number;
}

// Failure types
export interface FailureEntry {
	invocationId: string;
	modelId: string;
	modelName: string;
	response: string;
	responsePayload: unknown;
	createdAt: Date;
	toolCalls: ToolCallFailure[];
	failureReason: string | null;
	/** Step-level execution telemetry for debugging */
	stepTelemetry?: StepTelemetry[];
	/** Total steps executed before failure/completion */
	totalSteps?: number;
	/** Total input tokens consumed */
	totalInputTokens?: number;
	/** Total output tokens consumed */
	totalOutputTokens?: number;
}

export interface ToolCallFailure {
	id: string;
	toolCallType: string;
	metadata: string;
	createdAt: Date;
}

export interface ModelFailureStats {
	modelId: string;
	modelName: string;
	variant: string;
	failedWorkflowCount: number;
	failedToolCallCount: number;
	/** Number of unique failed invocations (an invocation with both failure types counts once) */
	failedCount: number;
	invocationCount: number;
	failureRate: number;
}
