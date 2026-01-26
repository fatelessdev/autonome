/**
 * Tool Context Types
 * Shared interfaces and types for trading agent tools
 */

import type { Account } from "@/server/features/trading/accounts";
import type {
	InvocationClosedPositionSummary,
	InvocationDecisionSummary,
	InvocationExecutionResultSummary,
} from "@/server/features/trading/invocationResponse";
import type { EnrichedOpenPosition } from "@/server/features/trading/openPositionEnrichment";
import type { TradingDecisionWithContext } from "@/server/features/trading/tradingDecisions";

// TODO: Re-enable symbol action limits later
// /** Maximum actions (create/close) per symbol per session */
// export const MAX_ACTIONS_PER_SYMBOL = 2;
export const MAX_ACTIONS_PER_SYMBOL = Infinity;

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
	closedPositionCooldowns: Map<string, { side: "LONG" | "SHORT"; cooldownUntil: string }>;

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
 * Result from a position creation/update operation
 */
export interface PositionResult {
	symbol: string;
	side: "LONG" | "SHORT" | "HOLD";
	quantity: number | null;
	leverage: number | null;
	success: boolean;
	error?: string | null;
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
