# ULTIMATE PLAN: Remaining Autonome Gaps

**Audit date:** 2026-05-14
**Purpose:** Remaining implementation gaps only. Items already implemented in the repo, including items hidden inside HTML comments in the old files, have been removed from this plan.

This file is intentionally not a historical comparison dump anymore. It is the working gap analysis for Autonome after checking the current codebase.

---

## Remaining P0: Safety And Execution Guardrails

### 1. PolicyEngine - Pre-Execution Trade Validation

**Status:** Not implemented.

**Why it remains:** `createPosition.ts` still submits accepted LONG orders through the Alpaca provider after local shape checks, minimum notional checks, and cash-cap adjustment. There is no central policy layer for kill switch, daily loss limit, max open positions, max notional, position concentration, symbol allow/deny lists, or drawdown shield.

**Build:**

1. Create `src/server/features/trading/policyEngine.ts`.
2. Create `src/server/features/trading/policyConfig.ts`.
3. Add DB-backed risk state for kill switch, cooldowns, daily loss, and drawdown state.
4. Call `evaluate()` before any buy order reaches Alpaca.
5. Return policy violations to the tool response so the model knows why a trade was rejected.
6. Let exits through even when entry restrictions are active.
7. Add an emergency kill-switch API/admin path.

**Touches:** `createPosition.ts`, `closePosition.ts`, `src/db/schema.ts`, `api/src/index.ts`.

---

### 2. Drawdown Monitor And Circuit Breaker

**Status:** Not implemented.

**Why it remains:** Performance metrics compute drawdown for reporting, but there is no code path that halts new entries or triggers emergency behavior when drawdown or consecutive losses breach a threshold.

**Build:**

1. Create `src/server/features/trading/drawdownMonitor.ts`.
2. Track rolling drawdown from `PortfolioSize` snapshots.
3. Track consecutive realized losses.
4. Feed drawdown/session-cooldown state into PolicyEngine.
5. Add prompt text explaining which rules are code-enforced once the policy layer exists.

**Touches:** `tradeCycle.ts`, `tradeWorkflow.ts`, `promptBase.ts`.

---

### 3. Confidence-Scaled Position Sizing

**Status:** Not implemented.

**Why it remains:** Confidence is captured and stored, but `createPosition.ts` does not mechanically scale quantity by confidence.

**Build:**

1. Convert `confidence` into a sizing multiplier before broker submission.
2. Reject very low-confidence entries in PolicyEngine.
3. Surface the final adjusted quantity and reason in the tool response.
4. Update prompts only after the behavior is enforced in code.

**Touches:** `createPosition.ts`, `createPositionTool.ts`, `promptBase.ts`.

---

## Remaining P1: Agent Reliability

### 4. Tool Output Validation And Generate-Validate-Retry

**Status:** Not implemented.

**Why it remains:** Zod validates tool input shape, but there is no dedicated semantic validator/retry loop that catches execution-intent mismatches and feeds structured correction back into the next agent step.

**Build:**

1. Create `src/server/features/trading/agent/outputValidator.ts`.
2. Add semantic checks: SL/TP direction, minimum notional, supported symbols, confidence range, spot-only side constraints, and duplicate action constraints.
3. On validation failure, inject a structured user message through `prepareStep`.
4. Keep retry budget small and explicit.

**Touches:** `tradeAgentFactory.ts`, `createPositionTool.ts`, `closePositionTool.ts`.

---

### 5. Output Sanitization Fallback

**Status:** Not implemented.

**Why it remains:** If model output/tool orchestration fails because of malformed output, the workflow logs the failure. There is no cheap sanitizer model or schema repair pass.

**Build:**

1. Create `src/server/features/trading/agent/outputSanitizer.ts`.
2. Validate candidate output before accepting it.
3. Use a cheap fallback model to normalize malformed output into the expected schema.
4. Fail fast if sanitizer output is also invalid.

**Touches:** `tradeWorkflow.ts`, `tradeAgentFactory.ts`.

---

## Remaining P1: Backtesting Foundation

### 6. Exchange Adapter Interface

**Status:** Not implemented.

**Why it remains:** Trading tools still call the Alpaca provider path directly. There is no shared interface that can swap live Alpaca execution for simulated execution.

**Build:**

1. Create `src/server/features/trading/exchange/IExchangeAdapter.ts`.
2. Implement `AlpacaLiveAdapter`.
3. Implement `BacktestAdapter`.
4. Inject the adapter through tool context.
5. Keep prompt building and tool definitions shared between live and backtest modes.

**Touches:** `src/server/features/trading/agent/tools/`, `createPosition.ts`, `closePosition.ts`.

---

### 7. Event-Driven Backtesting Engine

**Status:** Not implemented.

**Why it remains:** There is no `backtester/` feature, no historical replay runner, no backtest storage schema, and no simulation adapter.

**Build:**

1. Create `src/server/features/backtester/backtestSandbox.ts`.
2. Create `src/server/features/backtester/backtestEngine.ts`.
3. Create `src/server/features/backtester/dataLoader.ts`.
4. Store `BacktestRun` and `BacktestTrade` records.
5. Include realistic fees, slippage, minimum trade sizes, and no same-bar future leakage.
6. Reuse the live agent/tool loop against the backtest adapter.

**Touches:** `src/db/schema.ts`, `tradeAgentFactory.ts`, new `backtester/` files.

---

### 8. Anti-Look-Ahead Historical Replay Controls

**Status:** Not implemented.

**Why it remains:** No historical replay exists yet. These controls must be built into the backtest adapter from the start.

**Build:**

1. At a simulation timestamp, expose only data available at or before that timestamp.
2. For the current candle, expose only the data that would be known at that moment.
3. Filter news, sentiment, and market intelligence by simulation timestamp.
4. Add tests that prove future candles and future news cannot leak into prompts.

**Touches:** `BacktestAdapter`, `dataLoader`, market-intelligence formatting for backtests.

---

### 9. Intra-Candle Fill Simulation

**Status:** Not implemented.

**Why it remains:** Live execution is broker-backed; no local fill simulator exists.

**Build:**

1. Simulate limit/stop fills using candle high/low/open/close without look-ahead.
2. Sort multiple pending orders by reachable price path.
3. Track fees, slippage, partial fills, and order lifecycle.
4. Preserve spot-only assumptions.

**Touches:** `backtestSandbox.ts`, `backtestEngine.ts`.

---

## Remaining P2: Market Intelligence And Decision Quality

### 10. Dual-LLM Pre-Screening

**Status:** Not implemented.

**Why it remains:** Each active model still receives the broad market context directly. There is no cheap research pass that filters symbols before the main model sees them.

**Build:**

1. Create `src/server/features/trading/agent/preScreener.ts`.
2. Score symbols with a cheaper model.
3. Include only candidates above threshold in the expensive model context.
4. Store pre-screen scores in the decision diary for audit.

**Touches:** `tradeWorkflow.ts`, `marketIntelligenceCache.ts`, `decisionDiaryService.ts`.

---

### 11. Sentiment Scoring And Trust-Weighted Aggregation

**Status:** Partially implemented only as raw news ingestion.

**Why it remains:** Alpaca news is fetched and formatted, but there is no structured sentiment score, source trust weighting, social source aggregation, or time-decay model.

**Build:**

1. Create `src/server/features/intelligence/sentimentGatherer.ts`.
2. Create `src/server/features/intelligence/signalAggregator.ts`.
3. Start with CoinGecko trending and Crypto Fear & Greed.
4. Add source weights and two-hour half-life decay.
5. Inject a concise `SENTIMENT_INTELLIGENCE` prompt section.

**Touches:** `tradeWorkflow.ts`, `promptBase.ts`, `decisionDiaryService.ts`.

---

### 12. Cognitive Memory Service

**Status:** Not implemented.

**Why it remains:** DecisionDiary and MarketState store structured history, but there is no layered memory service that summarizes lessons, retrieves similar past setups, or injects outcome-based guidance into prompts.

**Build:**

1. Create a memory service over DecisionDiary and closed trade outcomes.
2. Retrieve similar symbol/regime/setup histories.
3. Summarize lessons with strict source references.
4. Inject only compact, relevant lessons into prompts.

**Touches:** `decisionDiaryService.ts`, `promptBase.ts`, `tradeWorkflow.ts`.

---

### 13. Reconciliation Close-Trigger Attribution

**Status:** Partially implemented.

**Why it remains:** Basic reconciliation exists and closes orphaned DB orders with `closeTrigger: "RECONCILE"`, but it does not yet distinguish broker-triggered stop-loss and take-profit exits.

**Build:** Detect whether the broker-side close came from an SL/TP order and store a more specific trigger such as `bracket_sl` or `bracket_tp` instead of generic reconciliation.

**Touches:** `reconciliation.ts`, Alpaca closed-order lookup, order close metadata.

---

## Remaining P3: Strategic Research Capabilities

### 14. Manual Approval Mode

**Status:** Not implemented.

**Build:** Add a mode where the agent creates trade proposals, the UI displays them, and only approved proposals execute.

**Touches:** `src/db/schema.ts`, oRPC router, SSE events, dashboard UI.

---

### 15. Consensus Or Analysis-Only Multi-Agent Workflow

**Status:** Not implemented.

**Build:** If revived, keep it out of the live execution critical path. Use it for research/backtest analysis or a two-stage screen-then-decide pipeline.

**Touches:** new `consensus/` or `research/` feature area.

---

### 16. Backtest Metrics Dashboard

**Status:** Not implemented.

**Build:** After the backtester exists, display total return, max drawdown, win rate, Sharpe, trade duration, fees, slippage, and per-variant comparisons.

**Touches:** backtester tables, oRPC analytics routes, dashboard UI.

---

### 17. Monte Carlo Stress Testing

**Status:** Not implemented.

**Build:** After backtesting exists, run trade-order shuffling and candle-window resampling to estimate drawdown, ruin probability, and return distribution.

**Touches:** `src/server/features/backtester/monteCarlo.ts`.

---

### 18. Offline/Online Feature Consistency For Future ML

**Status:** Not implemented.

**Build:** If a classical ML layer is added, share one feature generator between training, backtesting, and live inference to avoid train-serve skew.

---

### 19. Adaptive Variant Allocation

**Status:** Not implemented.

**Build:** Route capital or decision priority based on rolling performance, market regime, volatility, and drawdown. Keep this as a paper-trading/backtest-first feature.

---

### 20. External Signal And Deep Data Backlog

**Status:** Not implemented.

**Candidates:**

- TradingView webhook ingestion.
- On-chain analytics.
- Order-flow footprint.
- Liquidity analysis.
- Arbitrage scanner.
- Funding-rate prediction as an informational signal only.
- A/B testing framework.

Do not add leverage or futures execution as part of these items unless the spot-only product decision changes.
