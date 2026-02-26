/**
 * Trading Agent Module
 * Re-exports all agent components for clean imports
 */

export {
	type AgentOutput,
	agentOutputSchema,
	type CallOptions,
	callOptionsSchema,
	type DecisionInput,
	decisionSchema,
	marketSymbols,
	type NormalizedDecision,
} from "./schemas";
export {
	createTradingTools,
	type ToolContext,
	type TradingTools,
} from "./tools";
export {
	createTradeAgent,
	type TradeAgent,
	type TradeAgentConfig,
} from "./tradeAgentFactory";
