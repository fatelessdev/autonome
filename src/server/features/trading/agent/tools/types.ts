/**
 * Tool Context Types
 * Shared interfaces and types for trading agent tools
 */

import type { Account } from "@/server/features/trading/contracts/accounts";
import type {
	InvocationClosedPositionSummary,
	InvocationDecisionSummary,
	InvocationExecutionResultSummary,
} from "@/server/features/trading/contracts/invocationResponse";
import type { TradingDecisionWithContext } from "@/server/features/trading/contracts/tradingDecisions";
import type { EnrichedOpenPosition } from "@/server/features/trading/data/openPositionEnrichment";

export type { PositionResult } from "@/server/features/trading/execution/createPosition";

/** Maximum actions (create/close) per symbol per session */
export const MAX_ACTIONS_PER_SYMBOL = 3;

/**
 * Minimum notional value (USD) for any trade to be submitted to the broker.
 * Trades below this threshold are rejected before reaching Alpaca.
 */
export const MINIMUM_TRADE_SIZE_USD = 50;

/**
 * Shared context passed to all tools during a trading session.
 * Contains account info, invocation tracking, and mutable state.
 */
export interface ToolContext {
	/** The account/model executing trades */
	account: Account;

	/** Current invocation ID for tool call tracking */
	invocationId: string;

	/** Open positions enriched with decision context */
	openPositions: EnrichedOpenPosition[];

	/** Decision index for tracking trading decisions */
	decisionIndex: Map<string, TradingDecisionWithContext>;

	/** Symbols already acted on this session (prevents duplicate actions) */
	actedSymbols: Set<string>;

	/**
	 * Cooldown tracking for recently closed positions.
	 * Maps symbol -> { side: "LONG"|"SHORT", cooldownUntil: ISO timestamp }
	 * Used to enforce cooldown even after position is closed.
	 */
	closedPositionCooldowns: Map<
		string,
		{ side: "LONG" | "SHORT"; cooldownUntil: string }
	>;

	/**
	 * Per-symbol action counts for session limits.
	 * Tracks number of create/close actions per symbol.
	 */
	symbolActionCounts: Map<string, number>;

	/** Captured decisions for invocation payload */
	capturedDecisions: InvocationDecisionSummary[];

	/** Captured execution results for invocation payload */
	capturedExecutionResults: InvocationExecutionResultSummary[];

	/** Captured closed positions for invocation payload */
	capturedClosedPositions: InvocationClosedPositionSummary[];
}

/**
 * Result from a position close operation
 */
export interface ClosePositionResult {
	symbol: string;
	side: "LONG" | "SHORT";
	quantity: number | null;
	entryPrice: number | null;
	exitPrice: number | null;
	netPnl: number | null;
	realizedPnl: number | null;
	unrealizedPnl: number | null;
	closedAt: string | null;
}
