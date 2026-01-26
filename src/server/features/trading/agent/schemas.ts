/**
 * Zod schemas for the trading agent
 * Centralized schema definitions for decisions, output, and call options
 */

import { z } from "zod";
import { MARKETS } from "@/shared/markets/marketMetadata";

// Market symbols enum for validation
export const marketSymbols = Object.keys(MARKETS) as [
	keyof typeof MARKETS,
	...(keyof typeof MARKETS)[],
];

/**
 * Schema for a single trading decision
 */
export const decisionSchema = z.object({
	symbol: z
		.enum(Object.keys(MARKETS) as [string, ...string[]])
		.describe("Trading pair symbol (e.g., BTC, ETH, SOL)"),
	side: z.enum(["LONG", "SHORT", "HOLD"]).describe("Trade direction"),
	quantity: z
		.number()
		.positive()
		.max(100_000)
		.describe("Position size in base asset units (e.g., 0.5 BTC). Must be positive and ≤100,000."),
	leverage: z
		.number()
		.min(1)
		.max(20)
		.describe("Leverage multiplier (1-20x)"),
	profit_target: z.number().positive().describe("Take profit price level"),
	stop_loss: z.number().positive().describe("Stop loss price level"),
	invalidation_condition: z
		.string()
		.describe("When to exit if thesis breaks (e.g., '4h close above EMA50')"),
	invalidation_price: z
		.number()
		.optional()
		.nullable()
		.describe("Exact price level where thesis is invalidated"),
	time_exit: z
		.string()
		.optional()
		.describe("Maximum hold duration condition (e.g., 'Close if held >24h and within 1R of entry')"),
	cooldown_minutes: z
		.number()
		.min(1)
		.max(15)
		.optional()
		.describe("Cooldown duration in minutes (1-15) before direction change allowed. System calculates timestamp."),
	confidence: z
		.number()
		.min(0)
		.max(100)
		.describe("Setup quality score from 0 (lowest) to 100 (highest)"),
});

export type DecisionInput = z.infer<typeof decisionSchema>;

/**
 * Schema for agent structured output
 */
export const agentOutputSchema = z.object({
	status: z
		.enum(["trading", "holding"])
		.describe("Whether positions were taken or held"),
	summary: z.string().describe("Brief summary of actions taken"),
	actionsCount: z.number().describe("Number of trading actions executed"),
});

export type AgentOutput = z.infer<typeof agentOutputSchema>;

/**
 * Schema for call options (type-safe runtime configuration)
 */
export const callOptionsSchema = z.object({
	maxSteps: z
		.number()
		.optional()
		.describe("Override max steps for this call"),
	reasoningEffort: z
		.enum(["low", "medium", "high"])
		.optional()
		.describe("Reasoning effort level"),
});

export type CallOptions = z.infer<typeof callOptionsSchema>;

/**
 * Normalized decision structure after parsing AI output
 */
export interface NormalizedDecision {
	symbol: string;
	side: "LONG" | "SHORT" | "HOLD";
	quantity: number;
	leverage: number | null;
	profitTarget: number | null;
	stopLoss: number | null;
	invalidationCondition: string | null;
	invalidationPrice: number | null;
	timeExit: string | null;
	cooldownUntil: string | null;
	confidence: number | null;
}
