# ULTIMATE PLAN (MERGED): Autonome AI Trading Enhancement Roadmap

## Executive Summary

This is the single consolidated plan merging `ultimate-plan.md` (Gemini/GLM/Claude analyses + AI-Trading-Agent + Bonerbots comparisons), `ultimate-plan-new.md` (Vibetrading + MAHORAGA deep dives), and `autonome/future_plan.md` (backlog of known gaps). All already-implemented features have been removed. The remaining items are organized by category, then ranked at the end by **implementation speed x trading gain impact**.

### Source Analysis Summary

| Plan | Key Strengths | Unique Contributions |
|------|--------------|---------------------|
| **Gemini** | High-level strategic thinking | Regime-Marshal Agent, Shadow Trading (Darwinism), Semantic Self-Review |
| **GLM** | Deep technical implementation | On-Chain Analytics, Liquidity Analysis, Arbitrage Detection, Order Flow Footprint |
| **Claude** | Systematic comparison & prioritization | Hysteresis/Cooldown rules, Exit Plan enforcement, Phased action plan |
| **Vibetrading** | Best backtester | StaticSandbox (1015 lines), AST validation, generate-validate-retry loop, Welford's Sharpe |
| **MAHORAGA** | Best risk management + data pipeline | PolicyEngine (11+9 checks), Staleness scoring, Confidence-scaled sizing, Multi-source sentiment with trust weights, Dual-LLM architecture |

### What's Already Done (Removed from Plan)

| Feature | Status | Evidence |
|---------|--------|----------|
| Hysteresis/Cooldown/Exit Plan rules in prompts | DONE | All 3 active variant prompts |
| Cooldown enforcement in code | DONE | `createPositionTool.ts` `checkCooldown()` |
| MAX_ACTIONS_PER_SYMBOL re-enabled | DONE | `types.ts` value = 3 |
| prepareStep portfolio refresh (append approach) | DONE | `tradeAgentFactory.ts` |
| Real TP/SL trigger orders on exchange | DONE | `createPosition.ts` bracket orders (equities) + independent SL/TP (crypto) |
| Candlestick API 403 fix | DONE | `CandlestickApiCompat` in `client.ts` |
| Dynamic indicator fetching (TAAPI) | DONE | `integrations/taapi/` + `fetchIndicatorsTool.ts` |
| SDK migration to `@reservoir0x/lighter-ts-sdk` | DONE | All imports updated |
| ToolCallAnalyzer rewrite (deterministic + LLM hybrid) | DONE (but disabled) | `toolCallAnalyzer.ts` exists, never called |
| HOLDING tool type + UI display | DONE | `holdingTool.ts` + `model-chat-tab.tsx` |
| News integration (Alpaca News API) | DONE | `integrations/alpaca-news/client.ts` |
| Reasoning framework in prompts | DONE | All variant prompts mandate structured analysis |
| First-Principles Reasoning Recipe | DONE | Active in sovereign, trendsurfer, contrarian prompts |
| Minimum Trade Size Validation | DONE | `MINIMUM_TRADE_SIZE_USD = 50` in `createPosition.ts` |
| Trade Size Auto-Adjustment | DONE | Capped to available balance in `createPosition.ts` |
| Leverage Removal | DONE | All active surfaces clean (prompts, UI, analytics) |
| Fee Awareness in Prompts | DONE | All 3 variants via `promptBase.ts` |
| Prompt File Deduplication | DONE | `promptBase.ts` exports shared sections |
| Tool Schema Documentation | DONE | `{{TOOL_REFERENCE}}` in all variants |
| Cache Timing Consolidation | DONE | `CACHE_TIMING` from `cacheConfig.ts` |
| 5-Minute Interval Constant | DONE | `TRADE_CYCLE_INTERVAL` shared constant |
| WORKFLOW_POSTGRES_URL Removal | DONE | Removed from env.ts and .env.example |
| Symbol Action Counts Cleanup | DONE | Plumbing removed; `MAX_ACTIONS_PER_SYMBOL` preserved in `types.ts` |
| Consensus Dead Code Removal | DONE | Files deleted, references removed |
| Position Reconciliation | DONE | `reconciliation.ts` with RECONCILE trigger |
| Staleness Scoring | DONE | `stalenessAnalyzer.ts` (0-100 composite) |
| Fill Verification with Exponential Backoff | DONE | 500ms → 1s → 2s → 4s in `createPosition.ts` |
| Online Sharpe Ratio | DONE | Welford's algorithm in `welfordService.ts` + `welford.ts` |
| Error Deduplication | DONE | `errorDeduplicator.ts` with 5-min sliding window |
| Open Interest Data | DONE | Binance Futures OI via `binance-oi/` integration |
| Correlation Matrix | DONE | `correlationMatrix.ts` with prompt warnings at r > 0.8 |

---

## PART 1: CRITICAL SAFETY INFRASTRUCTURE

<!-- ### 1.1 PolicyEngine — Pre-Execution Trade Validation

**Problem:** Autonome has **zero pre-execution validation**. The LLM's tool calls go directly to the exchange. There is no kill switch, no daily loss limit, no position concentration check, no maximum positions cap. A hallucinating LLM can wipe out the account.

**Source:** MAHORAGA `src/policy/engine.ts` (513 lines)

**How it works:** Every buy order passes through `PolicyEngine.evaluate()` which runs 11 sequential checks. If ANY check produces a violation, the order is rejected before hitting the exchange. Sells bypass the PolicyEngine entirely (documented rationale: closing positions is risk-reducing, blocking exits during kill switch would trap users in losing positions).

**The 11 equity checks:**

| Check | Type | Logic |
|---|---|---|
| Kill Switch | Hard block | `riskState.kill_switch_active === true` |
| Cooldown | Hard block | `now < riskState.cooldown_until` |
| Daily Loss Limit | Hard block | `daily_loss_usd / equity >= max_daily_loss_pct` |
| Trading Hours | Block/Warn | Market must be open (skipped for crypto) |
| Symbol Filters | Hard block | Deny list + optional allow list |
| Order Type | Hard block | Only permitted order types |
| Notional Limit | Hard block | `notional > max_notional_per_trade` |
| Position Size | Block + Warn@80% | `(existing_value + new_notional) / equity > max_position_pct` |
| Open Positions | Hard block | `count >= max_open_positions` |
| Short Selling | Hard block | Can't sell more than you own (if disabled) |
| Buying Power | Hard block | `notional > (use_cash_only ? cash : buying_power)` |

```typescript
// The critical architectural decision: sells bypass policy
async function sell(symbol: string, reason: string): Promise<boolean> {
    if (riskState.kill_switch_active) {
        log("PolicyBroker", "sell_during_kill_switch", {
            symbol, reason,
            note: "Executing sell despite kill switch — closing is risk-reducing",
        });
    }
    await alpaca.trading.closePosition(symbol);
    return true;
}
```

**Implementation:**
1. Create `src/server/features/trading/policyEngine.ts`
2. Define a `PolicyConfig` with configurable limits (max daily loss %, max position concentration %, max open positions, max notional per trade, kill switch flag)
3. Create `evaluate(context: PolicyContext): PolicyResult` that returns `{allowed: boolean, violations: string[], warnings: string[]}`
4. Wire into `createPosition.ts` — call `evaluate()` before `executeOrderOnExchange()`. On rejection, return the violation as the tool result so the LLM knows WHY the trade was blocked and can adjust
5. Critical design decision from MAHORAGA: **let sells through always**. Don't block position exits during kill switch or cooldown
6. Store `riskState` in DB: daily loss tracking, cooldown timestamps, kill switch flag
7. Add `/api/kill-switch` endpoint for emergency halt
8. Add `max_daily_loss_pct` tracking: sum realized + unrealized P&L per day, compare against threshold

**Files to modify:** `createPosition.ts`, `closePosition.ts`
**Files to create:** `policyEngine.ts`, `policyConfig.ts`, add `risk_state` table to `schema.ts`
**Effort:** 6-8 hours -->

---

## PART 2: AGENTIC INTELLIGENCE UPGRADES

---
<!-- 
### 2.2 Confidence-Scaled Position Sizing

**Problem:** Autonome captures `confidence` in the `createPosition` tool schema (0-100 scale) and stores it in the exit plan, but **it is never used for position sizing**. The LLM decides the quantity directly, with no mechanical scaling.

**Source:** MAHORAGA `src/strategy/default/rules/entries.ts` (56 lines)

```typescript
const notional = Math.min(
    account.cash * (sizePct / 100) * r.confidence,  // confidence multiplies size
    ctx.config.max_position_value
);
if (notional < 100) continue;  // $100 minimum
```

A 0.6 confidence trade gets 60% of the target size. A 0.95 confidence trade gets 95%. The LLM's uncertainty is mechanically reflected in risk exposure.

**Implementation:**
1. In `createPosition.ts`, after the LLM specifies quantity but before executing: `adjustedQuantity = quantity * Math.max(0.5, confidence / 100)` — cap minimum at 50% to prevent dust
2. Add confidence thresholds to PolicyEngine: reject trades with confidence < 30, warn at < 50
3. Update system prompts: "Your confidence score will mechanically scale position size. A confidence of 60 results in 60% of your requested quantity being executed."
4. Optional tiered routing from original plan:
   - Confidence >= 80: Full size
   - Confidence 60-79: 50-80% size (scaled)
   - Confidence 40-59: Require manual approval (if approval mode built)
   - Confidence < 40: Reject automatically

**Files to modify:** `createPosition.ts`, `policyEngine.ts`, all variant prompts
**Effort:** 2 hours -->

---

### 2.3 Re-enable Tool Call Validation
<!-- 
**Problem:** The `analyzeToolCallFailure` function is fully coded (173 lines, deterministic + LLM hybrid) but **commented out and never called**. Zero detection of AI intent vs. execution mismatch.

**Source:** Already exists at `src/server/features/analytics/toolCallAnalyzer.ts`

**Additional Enhancement (from Vibetrading):** Add semantic validation rules inspired by Vibetrading's AST-based validation pipeline:
- SL below entry for longs (above for shorts)
- Leverage within exchange limits
- Quantity above exchange minimum
- Confidence between 0-100

On validation failure, inject structured feedback as a user message in `prepareStep` so the LLM self-corrects on the next step (Vibetrading's generate-validate-retry pattern).

```python
# Vibetrading's retry pattern to adapt:
for attempt in range(max_retries + 1):
    if attempt > 0 and last_validation and not last_validation.is_valid:
        messages.append({"role": "assistant", "content": code})      # "here's what you said"
        messages.append({"role": "user", "content": feedback})       # "here's what's wrong"
    response = litellm.completion(model=self.model, messages=messages)
```

**Implementation:**
1. Uncomment `analyzeToolCallFailure()` call in `tradeExecutor.ts`
2. Create `agent/outputValidator.ts` with Zod schema validation + semantic checks
3. On validation failure, inject structured feedback in `prepareStep` hook
4. Format errors as structured user message (Vibetrading pattern)

**Files to modify:** `tradeExecutor.ts` (uncomment), `tradeAgentFactory.ts` (prepareStep hook)
**Files to create:** `agent/outputValidator.ts`
**Effort:** 4 hours -->

---

### 2.4 Output Sanitization Fallback
<!-- 
**Problem:** If LLM returns malformed JSON, the entire invocation fails. No recovery attempt.

**Source:** AI-Trading-Agent uses a cheap sanitizer model:
```python
def _sanitize_output(raw_content: str, assets_list):
    payload = {
        "model": self.sanitize_model,  # cheap/fast model like gpt-4o-mini
        "messages": [{"role": "system", "content": "You are a strict JSON normalizer..."}],
        "response_format": {"type": "json_schema", ...}
    }
```

**Implementation:**
```typescript
// Add to autonome/src/server/features/trading/outputSanitizer.ts
export async function sanitizeAgentOutput(
  rawOutput: unknown,
  assets: string[]
): Promise<{ reasoning: string; decisions: Decision[] }> {
  if (isValidOutput(rawOutput)) return rawOutput;
  
  // Use cheap model to fix malformed output
  const sanitizer = createOpenRouter({ apiKey: env.OPENROUTER_API_KEY });
  const result = await sanitizer.chat("openai/gpt-4o-mini").generate({
    messages: [{
      role: "system",
      content: "You are a strict JSON normalizer. Fix the following output to match schema.",
    }, {
      role: "user",
      content: JSON.stringify(rawOutput),
    }],
    responseFormat: { type: "json_schema", schema: decisionSchema },
  });
  
  return JSON.parse(result.text);
}
```

**Files to create:** `outputSanitizer.ts`
**Files to modify:** `tradeExecutor.ts`
**Effort:** 4 hours -->

---

### 2.5 Position Reconciliation (Future Enhancement)

The basic reconciliation has been implemented (`reconciliation.ts`). Future enhancement: add bracket SL/TP trigger awareness so reconciliation can log `closeTrigger: "bracket_sl"` / `"bracket_tp"` instead of generic "RECONCILE".

---

## PART 3: DATA & INTELLIGENCE ENRICHMENT

### 3.2 News/Sentiment Scoring Integration

**Problem:** News integration exists (Alpaca News API fetches headlines), but there is no sentiment scoring. News is passed as raw text to the AI. No Jina integration, no structured sentiment analysis.

**Solution (multi-level):**

**Level 1 — Jina AI Search (quick win):**
- Integrate Jina AI Search for crypto news: `https://r.jina.ai/{url}` returns clean text
- Fetch recent headlines for each asset before decision
- Include sentiment summary in user prompt

**Level 2 — Multi-Source Aggregation with Trust Weights (from MAHORAGA):**
```typescript
const SOURCE_CONFIG = {
    weights: {
        stocktwits: 0.85,
        reddit_wallstreetbets: 0.6,       // Noisy — discounted
        reddit_stocks: 0.9,
        twitter_fintwit: 0.95,            // Highest social weight
        sec_8k: 0.95,                     // Tied for highest
    },
    flairMultipliers: {
        DD: 1.5,                          // Due diligence gets 50% boost
        "Technical Analysis": 1.3,
        YOLO: 0.6,                        // Discounted
        Meme: 0.4,
        Shitpost: 0.3,                    // Heavily discounted
    },
    decayHalfLifeMinutes: 120,           // Signals decay with 2-hour half-life
};
```

Signals aggregated per symbol, weighted by source trust × flair multiplier × time decay, ranked by composite score.

**Implementation:**
1. Create `src/server/features/intelligence/` directory
2. Start with CoinGecko trending API + Crypto Fear & Greed Index
3. Implement `SignalAggregator` with configurable trust weights
4. Format as `{{SENTIMENT_INTELLIGENCE}}` prompt section
5. Time decay: 2-hour half-life from MAHORAGA

**Files to create:** `intelligence/sentimentGatherer.ts`, `intelligence/signalAggregator.ts`
**Effort:** Level 1: 2-3 hours, Level 2: 8-12 hours total

---

## PART 4: STRATEGIC CAPABILITIES
<!-- 
### 4.1 Backtesting Engine

**Problem:** Autonome runs live/paper only. There is no way to test a strategy against past data, evaluate Sharpe ratios over historical periods, or iterate on prompt/tool configurations without spending API credits and waiting in real time. This is the **single highest-value missing feature**.

**Source:** Vibetrading `core/static_sandbox.py` (1015 lines)

**How it works:** A self-contained exchange simulator that replays historical OHLCV data from CSV files:
- **Time-traveling price lookup:** `DataFrame.index.asof(current_time)` for latest candle at or before simulation timestamp
- **Futures position accounting:** Handles position flipping (long→short in one trade) by splitting into reduce + open. Weighted average entry price on scale-in: `(old_notional + new_notional) / (old_qty + new_qty)`
- **Limit order fill simulation:** `_should_execute_order()` checks if candle's high/low touched limit price — buys fill when `low <= order_price`, sells fill when `high >= order_price`
- **Funding payment sweeps:** Iterates through all funding windows between previous and new timestamp, applying payments
- **Margin accounting:** `locked_margin` tracks total margin deployed, released on position reduction
- **Price cache with LRU eviction:** 500-entry cache with oldest-25% eviction

```python
# Core fill simulation logic
def _should_execute_order(self, order, current_price, high=None, low=None):
    lo = low if low is not None else current_price
    hi = high if high is not None else current_price
    if order["side"] in ("buy", "long"):
        return lo <= order["price"]     # buy fills when low touches limit
    if order["side"] in ("sell", "short"):
        return hi >= order["price"]     # sell fills when high touches limit
```

**Key design decision:** Use Autonome's existing agent loop, not Vibetrading's `exec()` pattern. The agent should still use tool calling, but tools hit the backtest sandbox instead of the live exchange. The agent doesn't know it's backtesting.

**Implementation:**
1. Create `src/server/features/backtester/backtestSandbox.ts` — port position accounting, margin math, limit order fill simulation, funding sweeps
2. Create `src/server/features/backtester/backtestEngine.ts` — time-stepping loop that calls `rebuildUserPrompt()` at each step and runs agent against historical snapshots
3. Create `src/server/features/backtester/dataLoader.ts` — load historical candles from CSV or fetch from Alpaca historical APIs and cache
4. Mock the `ToolContext` so tools read from/write to backtest sandbox instead of live exchange
5. Store backtest results in separate DB table for comparison across runs

**Phase 2 — Metrics Dashboard:**
- Total return, max drawdown, win rate, average trade duration, funding revenue, total fees
- Streaming metrics with adaptive frequency
- Compare results across prompt variants and model configurations

**Files to create:** `backtester/backtestSandbox.ts`, `backtester/backtestEngine.ts`, `backtester/dataLoader.ts`, `backtester/backtestRunner.ts`, `backtester/metricsCalculator.ts`
**Effort:** Phase 1: 3-5 days, Phase 2: 2-3 days -->

---
<!-- 
### 4.2 Dual-LLM Pre-Screening Pipeline

**Problem:** Each model analyzes ALL markets with the expensive primary model. Wasteful tokens and noisy context.

**Source:** MAHORAGA uses Research LLM (`gpt-4o-mini`, cheap) + Analyst LLM (`gpt-4o`, expensive):
1. **Research LLM** evaluates individual signals — returns `{verdict, confidence, entry_quality, red_flags, catalysts}`
2. **Analyst LLM** makes final portfolio-level decisions given filtered candidates

**Implementation:**
1. Add pre-screening step in `tradeExecutor.ts` before main agent loop
2. Call `gpt-4o-mini` to score each market symbol for opportunity (0-1 scale)
3. Only include symbols scoring > 0.3 in main agent's `{{MARKET_INTELLIGENCE}}`
4. Reduces token usage by ~40-60% for the expensive main model

**Files to modify:** `tradeExecutor.ts`, `marketIntelligenceCache.ts`
**Files to create:** `agent/preScreener.ts`
**Effort:** 4 hours -->

---
<!-- 
### 4.3 Manual Approval Mode

**Problem:** Users can't review AI decisions before execution.

**Solution:** Add trading mode toggle:
- **AUTO**: Current behavior (immediate execution)
- **MANUAL**: AI proposes trades → UI shows proposals with reasoning → User approves/rejects → Only approved trades execute

**Implementation:**
- Create `TradeProposal` table
- Add SSE events for proposals
- Build approval UI component

**Files to create:** `TradeProposal` schema, approval API routes, approval UI components
**Effort:** 6-8 hours -->

---

### 4.4 Consensus Workflow (Future Implementation)

**Status:** Removed from codebase (was dead code) — preserved here for future consideration.
**Previous files:** `consensusOrchestrator.ts`, `consensusVoting.ts`
**Description:** A full consensus orchestrator (720 lines) existed but was never called in production. The code has been removed to reduce maintenance burden. If revived, implement as a 2-stage pipeline (screen → decide) rather than parallel voting.
**Effort:** 2-4 hours to re-implement from scratch

---

## PART 5: ANALYTICS & MONITORING

<!-- 
## PART 6: FUTURE INNOVATIONS (Backlog)

These are cutting-edge features that differentiate from competitors. Implement after core is solid.

### 6.1 Regime-Marshal Agent (Hierarchical AI)
A master agent that NEVER trades, only reads macro data (DXY, VIX, Fed rates, BTC dominance) and sets global variable: `RISK_ON`, `RISK_OFF`, or `CHOP`. Trading agents subordinate to this signal — if Marshal says `RISK_OFF`, no longs allowed regardless of chart.

**Effort:** 1-2 days
**Gain potential:** 10-25% (prevents counter-regime trades)

### 6.2 Shadow Trading (Darwinism)
Run all prompt variants in parallel on paper. Track Sharpe ratio over rolling 4-hour window. Route real capital to the best-performing variant. Auto-adaptation to market regime.

**Effort:** 2-3 days
**Gain potential:** 15-30% (optimal variant always active)

### 6.3 Dynamic Variant Switching
Automatically switch between Sovereign/Trendsurfer/Contrarian based on:
- Market regime (bull/bear/sideways via ADX + trend direction)
- Current drawdown level
- Volatility level
- Competition ranking

Scoring system selects optimal variant for conditions. This is a simpler version of Shadow Trading.

**Effort:** 1-2 days
**Gain potential:** 10-20%

### 6.4 On-Chain Analytics
- Whale wallet tracking (>10M movements)
- DEX flow analysis (net buy/sell pressure)
- Exchange inflow/outflow (accumulation vs distribution)
- Smart money wallet tracking

**Effort:** 3-5 days
**Gain potential:** 5-15% (information edge)

### 6.5 Liquidity Pool Analysis
- Order book depth analysis
- Spread monitoring
- Iceberg order detection
- Liquidity sweep detection (false breakouts)

**Effort:** 3-5 days
**Gain potential:** 5-10%

### 6.6 Arbitrage Scanner
- Cross-exchange price discrepancy detection
- CEX-DEX arbitrage opportunities
- Spread > 0.5% alerts for execution

**Effort:** 2-3 days
**Gain potential:** 2-8% (pure alpha, uncorrelated)

### 6.7 DeFi Integration
- Liquidation cascade detection (reduce leverage when cascades start)
- Yield farming opportunity scanner
- Protocol risk scoring

**Effort:** 3-5 days
**Gain potential:** 3-10%

### 6.8 Order Flow Footprint
- Track institutional vs retail order flow
- Detect iceberg orders (hidden size)
- Buy/sell wall detection
- Aggressive flow exhaustion signals

**Effort:** 3-5 days
**Gain potential:** 5-15%

### 6.9 A/B Testing Framework
- Split capital between variants
- Track performance with statistical significance
- Auto-rebalance to winners

**Effort:** 2-3 days
**Gain potential:** 10-20% (optimal variant selection)

### 6.10 Monte Carlo Simulation
- Calculate probability of ruin, expected drawdown distributions
- Risk of ruin analysis per strategy variant

**Effort:** 1-2 days
**Gain potential:** 5-10% (better risk sizing)

### 6.11 Funding Rate Prediction
- Use historical funding patterns + OI changes to predict funding moves
- Trade funding rate inflection points

**Effort:** 1-2 days
**Gain potential:** 3-8% -->

---

## PART 7: PROMPT ADDITIONS (Copy-Paste Ready)

### Add to All Active Variants

```
== FEE AWARENESS ==
Every round-trip trade (open + close) costs approximately 0.1-0.3% in fees + slippage.
Your profit target must comfortably exceed this drag. Do not open positions with < 1% expected move.
Premature exits and re-entries bleed you dry through fees and slippage.
<!-- 
== CONFIDENCE IMPACT ==
Your confidence score (0-100) mechanically scales your position size.
Confidence 80+ = full requested size. Confidence 60 = 60% of requested size.
Confidence below 40 will be automatically rejected.
Be calibrated — don't always output 85+. -->
```

---

## PART 8: COMPETITIVE POSITIONING

### Where Autonome Excels (Keep & Amplify)
- Multi-model parallel execution (unique differentiator)
- 4+ strategy variants with distinct prompts
- Competition-aware prompts (leaderboard positioning)
- Real-time SSE architecture
- Full React dashboard + observability
- PostgreSQL schema + full audit trail
- Per-step state refresh in agent loop
- 3-tier fill verification
- True autonomous `ToolLoopAgent` (multi-step reasoning within one cycle)

### Where Autonome is Behind (Fix in Parts 1-4)
- Risk management: No PolicyEngine (MAHORAGA has 11 checks)
- Backtesting: Zero capability (Vibetrading has full simulator)
- Validation: Tool call analyzer disabled
- Safety: No circuit breaker

### Future Competitive Advantage (Part 6)
- Regime-Marshal + Shadow Trading = Adaptive AI hierarchy
- On-chain + Order Flow = Information edge
- Arbitrage + DeFi = Revenue diversification

---

## PART 9: KEY FILES TO MODIFY

| Feature | Primary Files |
|---------|---------------|
| Prompts | `src/server/features/trading/prompts/sovereign.ts`, `trendsurfer.ts`, `contrarian.ts` |
| Safety limits | `src/server/features/trading/agent/tools/types.ts` |
| Trade execution | `src/server/features/trading/execution/createPosition.ts` |
| Agent factory | `src/server/features/trading/agent/tradeAgentFactory.ts` |
| Tools | `src/server/features/trading/agent/tools/` |
| Schema | `src/db/schema.ts` |
| Workflow | `src/server/workflows/tradeCycle.ts`, `steps/tradeWorkflow.ts` |
| Market data | `src/server/features/trading/marketData.ts`, `marketIntelligenceCache.ts` |
| Prompt builder | `src/server/features/trading/promptBuilder.ts`, `promptSections.ts` |

---

## PART 10: RANKED IMPLEMENTATION PLAN

All remaining features ranked by a composite score: **(Implementation Speed × Trading Gain Impact)**. Speed is scored 1-10 (10 = fastest). Gain is scored 1-10 (10 = highest % increase in trading P&L). The composite is `Speed + Gain` to find the best bang-for-buck.

*Note: Many items from the original ranking have been implemented. See "What's Already Done" table above. The remaining items below represent future work.*

| Rank | Feature | Effort | Speed (1-10) | Gain Impact | Gain % Est. | Composite | Why |
|------|---------|--------|-------------|-------------|-------------|-----------|-----|
| **1** | **Confidence-Scaled Position Sizing** | 2 hrs | 9 | 7 | 8-20% | **16** | Quick win, mechanically ties conviction to risk — massive upside on sizing |
| **2** | **PolicyEngine** | 6-8 hrs | 5 | 10 | 15-35% (loss prevention) | **15** | Most critical safety feature — prevents catastrophic losses from hallucinating LLM |
| **3** | **Circuit Breaker** | 4 hrs | 7 | 8 | 10-30% (loss prevention) | **15** | Prevents portfolio wipeout scenarios |
| **4** | **Re-enable Tool Call Validation** | 1 hr (uncomment) + 3 hrs (enhance) | 8 | 6 | 5-12% | **14** | Code already exists — just uncomment + add semantic checks |
| **5** | **Output Sanitizer** | 4 hrs | 7 | 4 | 3-6% | **11** | Recovers from malformed LLM output instead of wasting cycles |
| **6** | **Dual-LLM Pre-Screening** | 4 hrs | 7 | 5 | 5-12% | **12** | Reduces token cost 40-60% AND improves signal quality via filtering |
| **7** | **Sentiment Scoring (Level 1)** | 2-3 hrs | 8 | 4 | 3-8% | **12** | Quick Jina/CoinGecko integration, gives AI news context |
| **8** | **Manual Approval Mode** | 6-8 hrs | 5 | 3 | 2-5% | **8** | Safety net, but slows execution speed |
| **9** | **Consensus Workflow (Revive)** | 2-4 hrs | 7 | 3 | 2-8% | **10** | Uncertain value — may improve or hurt |
| **10** | **Sentiment (Level 2 — Multi-Source)** | 8-12 hrs | 4 | 5 | 5-15% | **9** | Significant data edge but heavy implementation |
| **11** | **Backtesting Engine** | 3-5 days | 2 | 9 | 15-40% (indirect, enables optimization) | **11** | Highest long-term value, but slow to build. Every future improvement can be validated |
| **12** | **Regime-Marshal Agent** | 1-2 days | 4 | 7 | 10-25% | **11** | Prevents counter-regime trades (no longs in bear market) |
| **13** | **Dynamic Variant Switching** | 1-2 days | 4 | 6 | 10-20% | **10** | Auto-selects best strategy for conditions |
| **14** | **Shadow Trading / Darwinism** | 2-3 days | 3 | 8 | 15-30% | **11** | Highest ceiling of any feature, but complex |
| **15** | **Funding Rate Prediction** | 1-2 days | 5 | 4 | 3-8% | **9** | Niche but profitable for perpetual futures |
| **16** | **Monte Carlo Simulation** | 1-2 days | 5 | 3 | 3-8% | **8** | Better risk sizing, indirect gain |
| **17** | **A/B Testing Framework** | 2-3 days | 3 | 6 | 10-20% | **9** | Statistical variant selection |
| **18** | **Arbitrage Scanner** | 2-3 days | 3 | 5 | 2-8% | **8** | Pure alpha but needs multiple exchange integrations |
| **19** | **On-Chain Analytics** | 3-5 days | 2 | 5 | 5-15% | **7** | Information edge, heavy data engineering |
| **20** | **Order Flow Footprint** | 3-5 days | 2 | 5 | 5-15% | **7** | Institutional flow tracking, complex data |
| **21** | **Liquidity Pool Analysis** | 3-5 days | 2 | 4 | 5-10% | **6** | Order book depth, complex integration |
| **22** | **DeFi Integration** | 3-5 days | 2 | 4 | 3-10% | **6** | Liquidation cascades, yield farming |
| **23** | **Backtest Metrics Dashboard** | 2-3 days | 3 | 2 | 0% (analytics) | **5** | Only useful after backtester exists |

### Recommended Implementation Order (Sprint Plan)

*Note: Sprint 0 items and most Sprint 2 items have been completed. Remaining items below.*

**Sprint 1 — Core Safety (2-3 days):**
Prevent the AI from blowing up the account.
1. PolicyEngine (6-8 hrs)
2. Circuit Breaker (4 hrs)
3. Confidence-Scaled Position Sizing (2 hrs)

**Sprint 2 — Remaining Intelligence (2-3 days):**
4. Re-enable Tool Call Validation (1 hr uncomment + 3 hrs enhance)
5. Output Sanitizer (4 hrs)

**Sprint 3 — Efficiency & Data (3-4 days):**
6. Dual-LLM Pre-Screening (4 hrs)
7. Sentiment Scoring Level 1 (2-3 hrs)

**Sprint 4 — Backtesting (1-2 weeks):**
8. Backtesting Engine Phase 1 (3-5 days)
9. Backtest Metrics Dashboard (2-3 days)

**Sprint 5 — Adaptive Intelligence (1-2 weeks):**
10. Regime-Marshal Agent (1-2 days)
11. Dynamic Variant Switching (1-2 days)
12. Shadow Trading / Darwinism (2-3 days)

**Sprint 6 — Deep Data & Innovation (ongoing):**
13. Sentiment Level 2 Multi-Source (8-12 hrs)
14. On-Chain Analytics (3-5 days)
15. Order Flow Footprint (3-5 days)
16. Funding Rate Prediction (1-2 days)
17. Everything else from backlog

---

**Total estimated effort remaining:**
- Sprint 1 (safety): ~2-3 days
- Sprint 1-3 (professional): ~2 weeks
- Sprint 1-5 (adaptive AI): ~4-5 weeks
- Full roadmap: ~2-3 months
