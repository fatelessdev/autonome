# ULTIMATE PLAN (MERGED): Remaining Roadmap

**Audit date:** 2026-05-14
**Scope:** Ranked roadmap after pruning implemented work from both visible and HTML-commented sections of the original ultimate plan files.

This file is the actionable merged roadmap. Historical "already done" lists and no-action comparison notes were removed so the file only contains remaining or partial work.

---

## Ranked Implementation Plan

| Rank | Feature | Status | Effort | Why it matters |
|---|---|---|---|---|
| 1 | PolicyEngine | Not implemented | 6-8 hrs | Blocks hallucinated or oversized entries before Alpaca |
| 2 | Drawdown monitor / circuit breaker | Not implemented | 4 hrs | Halts new risk during drawdown or loss streaks |
| 3 | Confidence-scaled position sizing | Not implemented | 2 hrs | Mechanically ties conviction to exposure |
| 4 | Tool output validation + retry feedback | Not implemented | 4 hrs | Lets the model self-correct bad or inconsistent tool intent |
| 5 | Output sanitizer fallback | Not implemented | 4 hrs | Recovers malformed output with a cheap repair pass |
| 6 | Exchange adapter interface | Not implemented | 4-6 hrs | Required for live/backtest parity |
| 7 | Backtesting engine phase 1 | Not implemented | 3-5 days | Enables safe strategy and prompt validation |
| 8 | Anti-look-ahead replay controls | Not implemented | 2 hrs after adapter | Prevents inflated backtest results |
| 9 | Intra-candle fill simulation | Not implemented | 3 hrs after sandbox | Makes fills more realistic |
| 10 | Dual-LLM pre-screening | Not implemented | 4 hrs | Reduces token cost and context noise |
| 11 | Sentiment scoring level 1 | Partial: raw news only | 2-3 hrs | Converts headlines/trending data into structured prompt signal |
| 12 | Sentiment scoring level 2 | Not implemented | 8-12 hrs | Adds trust weights, decay, and multi-source aggregation |
| 13 | Cognitive memory service | Not implemented | 6-8 hrs | Turns diary/history into reusable lessons |
| 14 | Reconciliation close-trigger attribution | Partial: generic reconciliation only | 2-3 hrs | Separates broker SL/TP exits from generic orphan cleanup |
| 15 | Manual approval mode | Not implemented | 6-8 hrs | Lets users review proposed trades before execution |
| 16 | Consensus / analysis-only multi-agent workflow | Not implemented | 2-4 hrs | Useful for research/backtest analysis, not live latency path |
| 17 | Backtest metrics dashboard | Not implemented | 2-3 days | Makes backtest results comparable across variants |
| 18 | Monte Carlo stress testing | Not implemented | 1-2 days | Estimates ruin/drawdown distributions |
| 19 | Adaptive variant allocation | Not implemented | 2-3 days | Routes risk toward variants working in current conditions |
| 20 | External signal backlog | Not implemented | ongoing | TradingView, on-chain, liquidity, arbitrage, order flow, funding signals |

---

## Sprint 1: Core Safety

### PolicyEngine

Add a DB-backed pre-execution validator for new entries:

- kill switch
- daily loss limit
- rolling drawdown shield
- session cooldown after loss streaks
- max open positions
- max notional per trade
- max position concentration
- buying-power check
- symbol allow/deny list
- spot-only side constraints

Exits must remain allowed even while entry restrictions are active.

### Drawdown Monitor

Track rolling drawdown and consecutive losses from portfolio/trade history. Feed halt/cooldown state into PolicyEngine and expose the active restriction reason to the agent.

### Confidence-Scaled Position Sizing

Before broker submission, scale accepted quantities by confidence and return the final adjusted quantity in the tool result. Prompt text should describe this only after the enforcement exists.

---

## Sprint 2: Agent Reliability

### Tool Output Validation + Retry

Create semantic validation for proposed tool actions and inject concise correction messages into `prepareStep` when a model proposes invalid actions.

Validation should cover:

- TP/SL direction for long spot positions
- minimum notional
- supported symbol set
- confidence range
- duplicate action limits
- cooldown violations
- spot-only side restrictions

### Output Sanitizer

Add a cheap-model sanitizer only for malformed structured output. The sanitizer must validate against the same schema and fail fast if the repaired output is still invalid.

---

## Sprint 3: Backtesting Foundation

### Exchange Adapter

Introduce a shared exchange adapter so live Alpaca execution and simulated execution use the same tool-facing contract.

### Backtester

Build an event-driven backtester that reuses the live agent/tool loop against simulated historical data. Include:

- historical candle loading and caching
- realistic fees and slippage
- minimum trade sizes
- no same-bar future leakage
- backtest run/trade tables
- prompt snapshots for audit

### Replay Correctness

Add tests proving the model cannot see future candles, future news, or completed candle values that were unavailable at the simulation timestamp.

---

## Sprint 4: Intelligence Enrichment

### Dual-LLM Pre-Screening

Score candidate symbols with a cheaper model before the main model call. Store scores for audit and include only viable candidates in the expensive model context.

### Sentiment Scoring

Keep Alpaca news as one source, then add:

- CoinGecko trending
- Crypto Fear & Greed
- source trust weights
- time decay
- concise per-symbol sentiment summary

### Cognitive Memory

Use DecisionDiary and closed-trade outcomes to retrieve similar past setups and inject compact lessons into prompts.

### Reconciliation Close-Trigger Attribution

Basic reconciliation exists, but broker-side stop-loss and take-profit closes are still recorded as generic reconciliation. Add attribution so SL/TP-triggered exits are stored distinctly from ordinary orphan cleanup.

---

## Sprint 5: Research And Operator Controls

### Manual Approval

Add `AUTO` and `MANUAL` modes. In manual mode the agent writes trade proposals, the UI shows them, and only approved proposals execute.

### Analysis-Only Multi-Agent Workflow

If multi-agent consensus is revived, keep it in research or post-backtest analysis first. Avoid putting slow debate loops in the live 5-minute execution path.

### Backtest Metrics Dashboard

Expose backtest return, max drawdown, win rate, Sharpe, trade duration, fees, slippage, and per-variant comparisons.

---

## Sprint 6: Advanced Research Backlog

These remain unimplemented and should wait until safety plus backtesting are in place:

- Monte Carlo stress testing.
- Adaptive variant allocation / shadow trading.
- TradingView webhook ingestion.
- On-chain analytics.
- Liquidity depth and sweep analysis.
- Arbitrage scanner.
- Order-flow footprint.
- Funding-rate prediction as context only.
- A/B testing framework.
- Offline/online feature consistency if a classical ML layer is added.

Do not reintroduce leverage. Current product semantics are spot-only execution.

---

## Key Files For The Next Implementations

| Area | Files |
|---|---|
| Execution | `src/server/features/trading/execution/createPosition.ts`, `closePosition.ts` |
| Tools | `src/server/features/trading/agent/tools/` |
| Agent loop | `src/server/features/trading/agent/tradeAgentFactory.ts`, `src/server/features/trading/execution/tradeWorkflow.ts` |
| Prompts | `src/server/features/trading/prompting/prompts/promptBase.ts`, variant prompt files |
| DB | `src/db/schema.ts`, repositories under `src/server/db/` |
| Workflow | `src/server/workflows/tradeCycle.ts`, `src/server/workflows/steps/` |
| Market data | `src/server/features/trading/data/marketIntelligenceCache.ts`, `src/server/features/trading/prompting/marketIntelligenceFormatter.ts` |
| Diary/history | `src/server/features/trading/data/decisionDiaryService.ts` |
| API/UI | `api/src/index.ts`, oRPC routers, dashboard routes/components |
