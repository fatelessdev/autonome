/**
 * Trading Agent Module
 * Re-exports all agent components for clean imports
 */

export { createTradeAgent, type TradeAgentConfig, type TradeAgent } from "./tradeAgentFactory";
export { createTradingTools, type ToolContext, type TradingTools } from "./tools";
export {
	decisionSchema,
	agentOutputSchema,
	callOptionsSchema,
	marketSymbols,
	type DecisionInput,
	type AgentOutput,
	type CallOptions,
	type NormalizedDecision,
} from "./schemas";
