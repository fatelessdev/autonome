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

export const TOOL_REFERENCE_SECTION = `== TOOL REFERENCE ==
Below is the complete specification for each available tool.

── createPosition ──────────────────────────────────
Purpose: Open one or more new positions (or scale into existing ones).
Input: { decisions: Decision[] }

Decision schema:
  symbol              string (enum)   — Trading pair, e.g. BTC, ETH, SOL
  side                "LONG" | "SHORT" | "HOLD" — Trade direction
  quantity            number > 0, ≤100000 — Position size in BASE ASSET units (e.g. 0.5 BTC)
  profit_target       number > 0      — Take-profit price level
  stop_loss           number > 0      — Stop-loss price level
  invalidation_condition string       — Condition that kills the thesis (e.g. "4h close above EMA50")
  invalidation_price  number | null   — Exact price where thesis is invalidated (optional)
  time_exit           string | null   — Max hold duration (e.g. "Close if held >24h without profit") (optional)
  cooldown_minutes    number 1–15     — Minutes before direction change allowed (optional)
  confidence          number 0–100    — Setup quality score

Return: Summary of accepted, failed, and skipped decisions. Includes size adjustment notes if trade was capped to available balance.

Constraints:
  • quantity MUST be positive — zero or negative values are rejected
  • For LONG:  stop_loss < expected entry price, profit_target > expected entry price
  • For SHORT: stop_loss > expected entry price, profit_target < expected entry price
  • Minimum trade notional: $50 USD — smaller trades are rejected
  • symbol must be a supported market (BTC, ETH, SOL, etc.)
  • Cooldown: if a direction-flip cooldown is active on a symbol, the opposite-side entry is blocked
  • Each symbol is limited to 3 actions per session (create + close combined)
  • HOLD side = explicit no-trade for that symbol (no order placed)

── closePosition ───────────────────────────────────
Purpose: Close one or more open positions.
Input: { symbols: string[] }

  symbols  string[] (enum) — Array of symbols to close, e.g. ["BTC", "ETH"]

Return: Summary of closed positions with entry/exit prices and P&L.

Constraints:
  • Each symbol must have an open position — closing a non-existent position throws an error
  • symbol must be a supported market
  • Each symbol is limited to 3 actions per session
  • For crypto: pending SL/TP orders are cancelled before the position is closed

── holding ─────────────────────────────────────────
Purpose: Explicitly pass when no trading action is warranted.
Input: { reason: string }

  reason  string (max 1000 chars) — Brief explanation of why no action was taken

Return: "Holding: {reason}"

Constraints:
  • reason is required and must be ≤ 1000 characters
  • ALWAYS call holding() if you decide not to trade — never end without a tool call`;

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

export const CORRELATION_WARNINGS_BLOCK = `{{CORRELATION_WARNINGS}}`;

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
