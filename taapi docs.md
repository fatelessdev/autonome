# TAAPI Documentation for Autonome

This document is an exhaustive map of how TAAPI is used in this repository, including:
- What TAAPI is (in practical terms for this codebase)
- Every runtime integration path and use case
- How TAAPI data flows into prompts, decisions, and persisted analytics
- Caching, retries, rate-limit handling, and failure behavior
- How TAAPI relates to the broader trading API/execution stack

Scope: this covers the current as-built implementation in this repo.

---

## 1) TAAPI in this project: purpose and boundaries

### 1.1 What TAAPI is
TAAPI is an external technical-analysis API service. In Autonome, we use TAAPI for supplementary indicators that are not computed from our Alpaca bar pipeline in the same place/timeframe context.

### 1.2 What TAAPI is used for here
TAAPI is used as a market-regime/context layer, plus optional on-demand indicator fetches by the agent.

Primary TAAPI-powered indicators in core workflow:
- BBands (20)
- ADX (14)
- Supertrend (10)
- Ichimoku (default periods)
- VWAP

### 1.3 What TAAPI is NOT used for
TAAPI does not place orders and does not provide execution prices for order placement/settlement.

Execution and live position state are still broker-authoritative via Alpaca.
- Order execution: Alpaca Trading API
- Position/account snapshots: Alpaca
- Candles used for local indicators in market snapshots (EMA/RSI/MACD/ATR etc.): Alpaca market data

This boundary is explicitly reinforced in prompt rules:
- "Manual/Exchange indicators" for execution levels
- "Taapi/Binance indicators" for broad trend/regime context

Relevant file:
- `src/server/features/trading/prompting/prompts/promptBase.ts`

---

## 2) TAAPI integration surface (all files)

### 2.1 Core TAAPI integration module
- `src/server/integrations/taapi/client.ts`
- `src/server/integrations/taapi/types.ts`
- `src/server/integrations/taapi/cache.ts`
- `src/server/integrations/taapi/index.ts`

### 2.2 Configuration and key rotation
- `src/env.ts`

### 2.3 Trading pipeline call sites
- `src/server/features/trading/data/marketIntelligenceCache.ts`
- `src/server/features/trading/execution/tradeWorkflow.ts`
- `src/server/features/trading/prompting/marketIntelligenceFormatter.ts`
- `src/server/features/trading/prompting/promptBuilder.ts`
- `src/server/features/trading/data/decisionDiaryService.ts`

### 2.4 Agent tool exposure (on-demand TAAPI)
- `src/server/features/trading/agent/tools/fetchIndicatorsTool.ts`
- `src/server/features/trading/agent/tools/index.ts`

### 2.5 Prompt strategy docs that consume TAAPI-derived context
- `src/server/features/trading/prompting/prompts/promptBase.ts`
- `src/server/features/trading/prompting/prompts/trendsurfer.ts`
- `src/server/features/trading/prompting/prompts/contrarian.ts`
- `src/server/features/trading/prompting/prompts/sovereign.ts`

### 2.6 Persistence schema where TAAPI-derived fields land
- `src/db/schema.ts`
- `src/server/db/tradingRepository.ts`

### 2.7 Relevant workflow/API orchestration for context
- `src/server/workflows/tradeCycle.ts`
- `src/server/workflows/steps/tradeCycleStep.ts`
- `api/src/index.ts`

---

## 3) External TAAPI API usage details (as implemented)

### 3.1 Endpoint
The integration uses TAAPI bulk endpoint:
- `https://api.taapi.io/bulk`

Defined in:
- `src/server/integrations/taapi/client.ts` (`BULK_URL`)

### 3.2 Request style in this repo
Requests are JSON POSTs with fields:
- `secret`: API key (rotated from env)
- `construct`: single construct object in current implementation (not multi-construct request in one call)

Construct fields used:
- `exchange`: always `binancefutures`
- `symbol`: e.g. `BTC/USDT`
- `interval`: e.g. `1h`, `4h`
- `indicators`: list of indicator configs (`id`, `indicator`, optional `period`, optional other TAAPI fields)

Types:
- `TaapiBulkPayload`
- `TaapiConstruct`
- `TaapiIndicatorConfig`

Defined in:
- `src/server/integrations/taapi/types.ts`

### 3.3 Response handling in this repo
Expected shape:
- `data: TaapiBulkResponseItem[]`
- each item has `id`, `result`, optional `errors`

Mapping behavior:
- if item has `errors` -> result for that id becomes `null`
- else result for that id becomes the returned `result` object

This per-indicator nulling is important because failures can be partial.

---

## 4) Configuration and key rotation

TAAPI keys are optional server env vars:
- `TAAPI_API_KEY`
- `TAAPI_API_KEY1`
- `TAAPI_API_KEY2`
- `TAAPI_API_KEY3`
- `TAAPI_API_KEY4`

Defined in:
- `src/env.ts`

### 4.1 Rotation behavior
`createApiKeyRotator("TAAPI", [...keys])` creates a round-robin rotator.

Public functions:
- `getNextTaapiKey()`
- `getTaapiKeyCount()`

Integration behavior:
- `TaapiClient.isConfigured()` returns true when key count > 0
- If no keys exist, `getTaapiApiKey()` throws `[TAAPI] No TAAPI API keys configured`

---

## 5) TAAPI cache layers and timing

There are two cache layers relevant to TAAPI:

### 5.1 TAAPI response cache (indicator-level)
File: `src/server/integrations/taapi/cache.ts`

- In-memory singleton map
- Key format:
  - `asset:timeframe`
  - or `asset:timeframe:indicatorSet`
- TTL: 60 seconds
- Max entries: 100
- Simple oldest-entry eviction on capacity

Used by:
- `fetchBulkIndicators`
- `preFetchSupplementaryIndicators`
- `preFetchMultipleAssets`

### 5.2 Shared market intelligence cache (cycle-level)
File: `src/server/features/trading/data/marketIntelligenceCache.ts`

- Contains combined market snapshots + TAAPI + OI
- TTL: `CACHE_TIMING.MARKET` (120 seconds)
- Dedupes concurrent fetches with a shared in-flight promise
- TAAPI fetch is parallelized with market snapshots and OI

Important consequence:
- TAAPI may be called once per cycle window and reused across model runs
- cache invalidated after each trade cycle completion in `executeAllModelTrades`

---

## 6) Retry, timeout, and failure behavior

File: `src/server/integrations/taapi/client.ts`

### 6.1 Network timeout
- Per HTTP call timeout: 30 seconds (`FETCH_TIMEOUT_MS`)
- Uses `AbortController`

### 6.2 Retries
`postWithRetry(payload, retries=3, backoffMs=15000)`

Retry paths:
- HTTP `429` rate-limit
- timeout/AbortError
- network/fetch failures

Backoff:
- linear backoff: `backoffMs * (attempt + 1)`
- default wait progression: 15s, 30s (for first two retries)

### 6.3 Terminal errors
Can throw:
- `TAAPI rate limit exceeded after retries`
- `TAAPI error: <status> <statusText> - <body>`
- `TAAPI max retries exceeded`

### 6.4 Degradation semantics by call site
- `preFetchSupplementaryIndicators`: catches and returns all-null indicator object
- `preFetchMultipleAssets`: per-asset catch, stores all-null for failed asset
- `marketIntelligenceCache`: if TAAPI not configured, uses empty map
- `fetchIndicatorsTool`: throws on config missing, throws if requested indicator comes back null

---

## 7) Indicator universe and use modes

### 7.1 Pre-fetch indicator set (standard cycle context)
`preFetchSupplementaryIndicators(asset, interval="1h")` requests:
- bbands period 20
- adx period 14
- supertrend period 10
- ichimoku default
- vwap default

Returns:
- `TaapiPreFetchResult` (`bbands`, `adx`, `supertrend`, `ichimoku`, `vwap`, `fetchedAt`)

### 7.2 On-demand indicator set (agent tool)
`fetchIndicatorsTool` allows requesting from `AVAILABLE_TAAPI_INDICATORS`:
- ema, sma, rsi, macd, bbands, adx, supertrend, stochrsi,
  ichimoku, vwap, obv, cci, willr, mfi, roc, mom, sar,
  stoch, keltner, donchian, atr

Input constraints:
- symbol: base symbol without USDT suffix (e.g. `BTC`)
- timeframe: one of `1m`, `5m`, `15m`, `1h`, `4h`, `1d`
- indicators array length 1..10
- period 1..200 if provided

Tool normalizes symbol to `<SYMBOL>/USDT`.

---

## 8) End-to-end trading workflow data flow (where TAAPI is called)

### 8.1 Scheduler/workflow entry
- `api/src/index.ts` starts workflow world and trade cycle workflow
- `src/server/workflows/tradeCycle.ts` loops every `TRADE_CYCLE_INTERVAL`
- `src/server/workflows/steps/tradeCycleStep.ts` calls `executeAllModelTrades()`

### 8.2 During model execution
Inside `executeAllModelTrades -> runTradeWorkflow -> prepareTradeContext`:

1. Fetches shared market intelligence via `getSharedMarketIntelligence(...)`
2. `getSharedMarketIntelligence` performs parallel fetch:
   - Alpaca market snapshots
   - TAAPI prefetch for selected assets
   - Binance open interest
3. TAAPI result map is passed to prompt building and later persistence

Files:
- `src/server/features/trading/execution/tradeWorkflow.ts`
- `src/server/features/trading/data/marketIntelligenceCache.ts`

### 8.3 Prompt materialization
`buildTradingPrompts` calls `formatMarketIntelligence`.

`formatMarketIntelligence`:
- inserts TAAPI section into each symbol market block
- formats BBands/ADX/Supertrend/Ichimoku/VWAP with human-readable interpretation
- computes cloud-status and VWAP-relative status if current price available

Files:
- `src/server/features/trading/prompting/promptBuilder.ts`
- `src/server/features/trading/prompting/marketIntelligenceFormatter.ts`

### 8.4 Agent execution phase
Agent receives prompts + tools.
If model chooses, it can call `fetchIndicators` tool for additional TAAPI indicators on demand.

Files:
- `src/server/features/trading/agent/tradeAgentFactory.ts`
- `src/server/features/trading/agent/tools/index.ts`
- `src/server/features/trading/agent/tools/fetchIndicatorsTool.ts`

### 8.5 Persistence phase (TAAPI-derived analytics)
After invocation/trade cycle:
- Decision diary writes regime-related values from TAAPI map:
  - adx
  - regime class (trending/ranging/choppy)
  - coarse bbands position
  - supertrend direction
- Market state writes cycle-level regime context:
  - adxValue
  - regime
  - plus non-TAAPI top movers/correlations/OI

Files:
- `src/server/features/trading/data/decisionDiaryService.ts`
- `src/server/db/tradingRepository.ts`
- `src/db/schema.ts`

---

## 9) All TAAPI use cases in this project

This section enumerates every implemented TAAPI use case.

### 9.1 Use case A: baseline supplementary context per cycle
- Trigger: each trade-cycle context build
- Call path: `getSharedMarketIntelligence -> taapiClient.preFetchMultipleAssets`
- Goal: enrich prompt with broad regime indicators
- Failure mode: degrades to missing TAAPI section (no hard fail)

### 9.2 Use case B: strategy regime gating in prompts
TAAPI-derived fields materially influence prompt decision framework for all variants:
- Trendsurfer: ADX filter and cloud/trend interpretation
- Contrarian: ADX ranging filter and band/vwap context
- Sovereign: regime matrix using ADX/Ichimoku/VWAP/Supertrend

Files:
- `src/server/features/trading/prompting/prompts/trendsurfer.ts`
- `src/server/features/trading/prompting/prompts/contrarian.ts`
- `src/server/features/trading/prompting/prompts/sovereign.ts`

### 9.3 Use case C: decision diary regime metadata
Writes TAAPI-derived ADX/regime/supertrend/bbands classification to `DecisionDiary.marketSnapshot`.

### 9.4 Use case D: market state regime snapshot
Writes TAAPI-derived regime/adx into `MarketState` entries per model per cycle.

### 9.5 Use case E: on-demand deep indicator fetch by agent
Agent can call `fetchIndicators` for additional TAAPI indicators beyond the default prefetch set.

Typical reason:
- The model wants extra confirmation signals (e.g. ATR, MACD variants, RSI variants) not already in standard market intelligence block.

---

## 10) Internal API surface related to trading (and TAAPI relevance)

TAAPI itself is server-side only in current architecture; there is no frontend direct TAAPI endpoint.

### 10.1 Frontend/backend contract
Frontend calls backend oRPC endpoints under:
- `/api/rpc/*`

Mounted in:
- `api/src/index.ts`

Trading router procedures:
- `trading.getTrades`
- `trading.getPositions`
- `trading.getCryptoPrices`
- `trading.getPortfolioHistory`

Defined in:
- `src/server/orpc/router/trading.ts`
- `src/server/orpc/router/index.ts`

### 10.2 Where TAAPI effects become visible through API
TAAPI impacts what the model decides and what gets persisted, which then influences API-returned data indirectly:
- Invocations and response payloads
- DecisionDiary / MarketState analytics endpoints

Relevant routers:
- `src/server/orpc/router/models.ts`
- `src/server/orpc/router/diary.ts`
- `src/server/orpc/router/analytics.ts`

### 10.3 Realtime channels
SSE endpoints:
- `/api/events/dashboard`
- `/api/events/workflow`

These notify clients to refetch query-backed data where TAAPI-influenced outputs may appear.

File:
- `api/src/index.ts`

---

## 11) Symbol and exchange conventions

### 11.1 TAAPI symbols
TAAPI calls use `SYMBOL/USDT` format (e.g. `BTC/USDT`), exchange `binancefutures`.

### 11.2 Trading symbols and broker symbols
Execution side uses canonical symbol mapping and Alpaca symbol mapping (`BTC` <-> `BTC/USD`).

File:
- `src/core/shared/markets/marketMetadata.ts`

### 11.3 Free-plan symbol list source
`TAAPI_FREE_PLAN_SYMBOLS` is currently derived from `SUPPORTED_MARKETS`.

File:
- `src/server/integrations/taapi/types.ts`

Implementation note:
- There is an in-code comment in `preFetchMultipleAssets` saying free plan supports only BTC/ETH, but filtering logic currently accepts all symbols from `TAAPI_FREE_PLAN_SYMBOLS` (derived from all supported markets). The effective behavior therefore follows `SUPPORTED_MARKETS` at runtime.

---

## 12) Guardrails, invariants, and practical implications

### 12.1 TAAPI optionality
If no TAAPI keys are configured:
- core workflow still runs
- TAAPI map is empty / null-valued depending on path
- prompts lose supplementary section

### 12.2 Fail-open vs fail-fast behavior
- Cycle prefetch path is fail-open (graceful degrade to null indicators)
- Agent on-demand fetch tool is fail-fast (throws on missing config or null indicator results)

### 12.3 Data-source hierarchy in decisioning
Prompt policy says TAAPI is contextual/regime input, while execution levels should come from exchange/manual/local execution-relevant data.

This is consistent with broker authority guardrails in the trading code.

---

## 13) Concrete call graphs

### 13.1 Core cycle TAAPI call graph
`tradeCycleWorkflow`
-> `tradeCycleStep`
-> `executeAllModelTrades`
-> `runTradeWorkflow`
-> `prepareTradeContext`
-> `getSharedMarketIntelligence`
-> `taapiClient.preFetchMultipleAssets`
-> `taapiClient.preFetchSupplementaryIndicators`
-> `taapiClient.fetchBulkIndicators`
-> `taapiClient.postWithRetry`
-> `POST https://api.taapi.io/bulk`

### 13.2 On-demand indicator call graph
`createTradeAgent` tools
-> `fetchIndicatorsTool.execute`
-> `taapiClient.fetchBulkIndicators`
-> `taapiClient.postWithRetry`
-> `POST https://api.taapi.io/bulk`

### 13.3 Persistence call graph
`runTradeWorkflow`
-> `persistDiaryEntry`
-> `writeDecisionDiaryEntry` (TAAPI-derived adx/regime/bbands/supertrend)

`executeAllModelTrades`
-> `writeMarketStateEntry` (TAAPI-derived adx/regime)

---

## 14) Quick reference: key constants and limits

- TAAPI HTTP timeout: `30_000 ms`
- TAAPI retry attempts: `3`
- TAAPI default backoff base: `15_000 ms` (linear)
- TAAPI cache TTL: `60 s`
- TAAPI cache max size: `100`
- Market intelligence cache TTL: `CACHE_TIMING.MARKET` (`120 s`)
- Trade cycle interval: `TRADE_CYCLE_INTERVAL` (`5 min`)
- On-demand indicator request max count/tool call: `10`

---

## 15) File-by-file implementation notes

### `src/server/integrations/taapi/client.ts`
- Central TAAPI transport and retry logic
- Request payload construction
- Per-item error-to-null mapping
- Prefetch semantics and multi-asset loop

### `src/server/integrations/taapi/types.ts`
- Type contracts for payloads and indicator result models
- Supported on-demand indicator enum
- `TAAPI_FREE_PLAN_SYMBOLS` source

### `src/server/integrations/taapi/cache.ts`
- In-memory TTL cache used by client methods

### `src/server/features/trading/data/marketIntelligenceCache.ts`
- Integrates TAAPI with Alpaca snapshots and OI in shared cache

### `src/server/features/trading/prompting/marketIntelligenceFormatter.ts`
- Injects TAAPI indicator sections into prompt market blocks

### `src/server/features/trading/agent/tools/fetchIndicatorsTool.ts`
- Agent-facing on-demand TAAPI access with strict schema

### `src/server/features/trading/data/decisionDiaryService.ts`
- Extracts and persists TAAPI-derived regime metadata

### `src/env.ts`
- TAAPI env vars + rotator functions

---

## 16) Known implementation nuances and potential confusion points

1. Free-plan comment vs symbol filter logic
- Comment mentions BTC/ETH-only
- Actual filter uses `TAAPI_FREE_PLAN_SYMBOLS` = all `SUPPORTED_MARKETS`

2. Exchange/source mismatch by design
- Local execution-market data is Alpaca
- TAAPI indicators are from Binance Futures data (`binancefutures`)
- Prompt hierarchy intentionally treats TAAPI as contextual, not execution-price authority

3. Partial indicator failures
- Bulk response can partially fail; individual indicator ids become `null`
- Prefetch path tolerates this; on-demand tool treats null indicators as an error

4. Cache layer interaction
- TAAPI has 60s cache, market intelligence has 120s cache
- Same indicator may be reused through both layers before new external call

---

## 17) Minimal operational checklist for TAAPI in production

1. Configure at least one TAAPI key in env (`TAAPI_API_KEY...`).
2. Verify `taapiClient.isConfigured()` path executes true in logs/runtime.
3. Confirm market prompts show "Supplementary Indicators (1h, via TAAPI)".
4. Confirm DecisionDiary entries are receiving non-null ADX/regime fields.
5. Monitor `[TAAPI]` warnings for 429/network issues and tune key count as needed.

---

## 18) Related non-TAAPI trading execution files (for full context)

- `src/server/features/trading/execution/createPosition.ts`
- `src/server/features/trading/execution/closePosition.ts`
- `src/server/providers/alpaca/index.ts`
- `src/server/features/trading/data/marketData.ts`

These are included to understand where TAAPI ends and broker/execution begins.

---

If architecture changes (new TAAPI indicators, direct API endpoints, new exchanges, or changed prompt hierarchy), update this doc in the same PR as code changes.
