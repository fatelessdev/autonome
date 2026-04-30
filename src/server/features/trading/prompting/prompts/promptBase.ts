/**
 * Shared prompt sections used across all trading variant prompts.
 * Each variant imports these sections and composes them with strategy-specific content.
 */

// ─── SYSTEM PROMPT SHARED SECTIONS ───

export const TOOL_INTERFACE_SECTION = `== TOOL INTERFACE ==
Control portfolio via these tools (call directly):
- \`createPosition\`: Open new positions
- \`closePosition\`: Exit positions (to change SL/TP, close and reopen with new levels)
- \`holding\`: Explicit no-action (explain reasoning)
**Never output raw JSON or tool syntax as plain text.**`;

export const DATA_SOURCE_HIERARCHY_SECTION = `== DATA SOURCE HIERARCHY (CRITICAL) ==
You receive data from two sources. You must respect this hierarchy:
1.  **Manual/Exchange Indicators (Execution):** Use these for exact Entry Price, Stop Loss, and Invalidation. This is the order book you trade on.
2.  **Taapi/Binance Indicators (Context):** Use these (ADX, Supertrend, Ichimoku) *only* to determine the Broad Trend and Market Regime.`;

export const COOLDOWN_SECTION = `**WHY COOLDOWN?** Prevents impulsive direction flips. While a position is open, you cannot flip to the opposite direction until cooldown expires. This applies both while holding AND after closing. System enforces this.

**IMPORTANT:** Use these EXACT field names when calling createPosition:
1. invalidation_trigger -> invalidation_condition
2. invalidation_price -> invalidation_price
3. time_exit -> time_exit
4. cooldown_minutes -> cooldown_minutes`;

export const FEE_AWARENESS_SECTION = `== FEE & SLIPPAGE AWARENESS ==
Every round-trip trade (entry + exit) incurs costs:
- Exchange fees: ~0.04-0.10% per side (0.08-0.20% round-trip)
- Slippage: ~0.02-0.10% depending on liquidity and size
- Total round-trip cost: ~0.1-0.3%

Your profit targets MUST exceed fee drag. A trade targeting 0.2% gain
nets near-zero after fees. Minimum viable profit target: **0.5%+** to
ensure meaningful edge after costs. Factor fees into every entry/exit
decision and invalidation price calculation.`;

// ─── USER PROMPT SHARED SECTIONS ───

export const SESSION_HEADER = `Session: {{TOTAL_MINUTES}} min | Interval: 5 min | Invocations: {{INVOKATION_TIMES}} | {{CURRENT_TIME}} IST
Cash: {{AVAILABLE_CASH}} | Exposure: {{EXPOSURE_TO_EQUITY_PCT}}%`;

export const PORTFOLIO_BLOCK = `== PORTFOLIO ==
{{PORTFOLIO_SNAPSHOT}}`;

export const OPEN_POSITIONS_BLOCK = `== OPEN POSITIONS ==
{{OPEN_POSITIONS_TABLE}}`;

export const PERFORMANCE_BLOCK = `== PERFORMANCE ==
{{PERFORMANCE_OVERVIEW}}`;

export const NEWS_BLOCK = `== NEWS ==
{{NEWS}}`;

export const CLOSING_INSTRUCTION = `CRITICAL: End your response with a tool call. If no action needed, call holding() with your reasoning.`;

/**
 * Builds the MARKET DATA block with a variant-specific context guide.
 */
export function buildMarketDataBlock(contextGuide: string): string {
	return `== MARKET DATA ==
{{MARKET_INTELLIGENCE}}
${contextGuide}`;
}
