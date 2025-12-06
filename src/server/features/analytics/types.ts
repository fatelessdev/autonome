/**
 * Analytics Types - Trading statistics for model performance analysis
 */

/**
 * Step-level telemetry captured during agent execution.
 * Imported from invocationResponse but re-exported for analytics use.
 */
export interface StepTelemetry {
	stepNumber: number;
	toolNames: string[];
	inputTokens: number;
	outputTokens: number;
	totalTokens: number;
	timestamp: string;
}

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
	sharpeRatio: number;
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
	avgLeverage: number;
	medianLeverage: number;
	maxLeverage: number;
	avgConfidence: number;
	medianConfidence: number;
	maxConfidence: number;
	// Failure metrics
	failedWorkflowCount: number;
	failedToolCallCount: number;
	invocationCount: number;
	failureRate: number;
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
	leverage: number | null;
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
	invocationCount: number;
	failureRate: number;
}
