# Autonome

**Autonome** is an AI-powered autonomous cryptocurrency trading platform that blends TanStack Start, multi-provider AI strategies, and a high-fidelity trading simulator for both live and sandbox execution.

## Executive Summary
Autonome allows you to deploy autonomous trading agents ("Variants") that:
1.  **Analyze** market structure (Price, Volume, Indicators).
2.  **Reason** about risk and setups using LLMs (Claude, OpenAI, Mistral).
3.  **Execute** trades via Lighter DEX (Live) or a built-in Exchange Simulator.
4.  **Visualize** performance in real-time via a reactive dashboard.

## Tech Stack
| Layer | Technologies |
| --- | --- |
| **Framework** | TanStack Start (React 19, SSR), Vite |
| **Backend** | Bun, Hono, oRPC, Node.js |
| **Database** | PostgreSQL + Drizzle ORM |
| **AI Layer** | Vercel AI SDK v6 (Multi-provider orchestration) |
| **Styling** | Tailwind CSS v4, shadcn/ui |
| **Integration** | Lighter SDK (DEX), Sentry (Monitoring) |

## Architecture

![Architecture](https://github.com/fatelessdev/autonome/blob/main/public/architecture.png)

- **Frontend (Vercel)**: TanStack Start SPA. Connects to backend via oRPC and SSE (`/api/events/*`).
- **Backend (VPS)**: Hono API server running on Bun. Handles Trading Loop, Schedulers, and DB connections.
- **Hybrid Deployment**: The Frontend is designed for Edge deployment (Vercel), while the Backend requires a long-running process (VPS/Docker) for the autonomous agents.

## Core Features
- **Autonomous Trading Loop**: Agents wake up, analyze market data, and execute trades with risk controls.
- **Strategy Variants**: Plug-and-play strategies (e.g., "Guardian" for safety, "Apex" for momentum).
- **Exchange Simulator**: High-fidelity simulator for backtesting/forward-testing without real funds.
- **Real-time Analytics**: Live P&L, Sharpe Ratio, and trade history visualization.
- **Co-Pilot Chat**: Inspect the Agent's "Thought Process" and SQL tooling usage.

## Setup & Run

### Prerequisites
- [Bun](https://bun.sh) >= 1.1
- PostgreSQL 15+

### Installation
1. **Install dependencies**
   ```bash
   bun install
   ```
2. **Environment Setup**
   ```bash
   cp .env.example .env
   # Configure DATABASE_URL, API Keys (Anthropic/OpenAI), etc.
   ```
3. **Database Init**
   ```bash
   bun run db:generate
   bun run db:migrate
   bun run db:seed
   ```

### Development
Run both Frontend and Backend concurrently:
```bash
bun run dev:all
```
- Frontend: `http://localhost:5173`
- Backend: `http://localhost:8081`

### Production Build
```bash
# Frontend (Static/Serverless)
bun run build

# Backend (Standalone Bundle)
bun run build:api
bun run start:api
```

## Docker Deployment
The `docker-compose.yml` is configured for the **Backend** services (API + DB + Migrations).
The Frontend is typically deployed to Vercel or a separate container.

```bash
docker-compose up -d
```

## Environment Variables
See `src/env.ts` for type-safe environment definitions.

| Variable | Description |
| --- | --- |
| `TRADING_MODE` | `live` (Real Money) or `simulated` (Paper Trading) |
| `LIGHTER_API_KEY_INDEX` | Wallet index for Lighter DEX |
| `ANTHROPIC_API_KEY` | Primary AI Model Key |
| `IS_SIMULATION_ENABLED` | Feature flag for UI |

## Key Concepts
- **Variants**: Defined in `src/server/features/trading/prompts/variants.ts`. Each variant has a distinct System Prompt and Risk Profile.
- **Market Intelligence**: Aggregated in `marketData.ts`, converting technical indicators into context for the LLM.
- **Tool Loop**: Agents operate in a loop (`think` -> `tool` -> `think`), allowing complex multi-step reasoning.

## Contributing
1.  **Package Manager**: Use `bun` only.
2.  **Linting**: `bun run check` (Biome).
3.  **Data Fetching**: Use `oRPC` procedures, never raw `fetch`.

## Documentation
- [AGENTS.md](./AGENTS.md) - Developer Guidelines & Architecture Rules.
- [problems.md](./problems.md) - Known Technical Debt & Critical Issues Report.
