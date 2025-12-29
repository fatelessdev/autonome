# Monorepo Migration Guide

> **Status: IN PROGRESS** - Monorepo structure created but code has compilation issues that need manual fixing.

This document describes how to complete the migration from the monolith to the split frontend/backend architecture.

## Current Status

### ✅ Completed
- Monorepo structure created (packages/shared, packages/api, packages/web)
- Shared package with types, utilities, calculations
- API package skeleton with Hono server, routes, scheduler bootstrap
- Web package skeleton with Vite config, TanStack Router
- Files copied from src/ to packages/

### ⚠️ In Progress - Manual Fixes Needed
1. **lighter-sdk-ts DOM references** - The SDK has browser-only code (`window`, `FileReader`) that fails in Node.js
2. **Drizzle query builder types** - Some queries have type mismatches
3. **Type compatibility issues** - `null` vs `undefined` in trading types

### ❌ Not Started
- Full end-to-end testing
- Deployment configuration

## Architecture Overview

```
autonome/
├── packages/
│   ├── shared/          # Shared types, utilities, constants
│   │   └── src/
│   │       ├── trading/      # Trading calculations, types
│   │       ├── markets/      # Market metadata
│   │       ├── models/       # Model config
│   │       ├── cache/        # Cache config
│   │       └── formatting/   # Number formatting
│   │
│   ├── api/             # Hono API backend (runs on VPS)
│   │   └── src/
│   │       ├── routes/       # rpc.ts, chat.ts, events.ts
│   │       ├── orpc/         # oRPC router
│   │       ├── features/     # Trading, simulator, analytics
│   │       ├── events/       # SSE event emitters
│   │       ├── schedulers/   # Background jobs
│   │       ├── db/           # Database access
│   │       └── chat/         # SQL assistant
│   │
│   └── web/             # React SPA (deploys to Vercel/Netlify)
│       └── src/
│           ├── components/   # UI components
│           ├── routes/       # Page routes (no api/)
│           ├── hooks/        # React hooks
│           ├── orpc/         # oRPC client
│           └── styles/       # CSS
│
├── src/                 # Legacy code (to be removed after migration)
└── package.json         # Workspace root
```

## Migration Steps

### Step 1: Copy Server Code to packages/api

```bash
# From project root
mkdir -p packages/api/src/db
mkdir -p packages/api/src/orpc/router
mkdir -p packages/api/src/features
mkdir -p packages/api/src/events
mkdir -p packages/api/src/chat

# Copy database
cp -r src/db/* packages/api/src/db/

# Copy oRPC router
cp -r src/server/orpc/router/* packages/api/src/orpc/router/
cp src/server/orpc/schema.ts packages/api/src/orpc/

# Copy features
cp -r src/server/features/* packages/api/src/features/

# Copy events
cp -r src/server/events/* packages/api/src/events/

# Copy chat
cp -r src/server/chat/* packages/api/src/chat/

# Copy polyfill
cp src/polyfill.ts packages/api/src/
```

### Step 2: Copy Frontend Code to packages/web

```bash
mkdir -p packages/web/src/components
mkdir -p packages/web/src/hooks
mkdir -p packages/web/src/routes
mkdir -p packages/web/src/lib

# Copy components
cp -r src/components/* packages/web/src/components/

# Copy hooks
cp -r src/hooks/* packages/web/src/hooks/

# Copy routes (excluding api/)
cp src/routes/__root.tsx packages/web/src/routes/
cp src/routes/index.tsx packages/web/src/routes/
cp src/routes/analytics.tsx packages/web/src/routes/
cp src/routes/chat.tsx packages/web/src/routes/
cp src/routes/failures.tsx packages/web/src/routes/
cp src/routes/leaderboard.tsx packages/web/src/routes/

# Copy lib utilities
cp -r src/core/lib/* packages/web/src/lib/

# Copy styles
cp src/styles.css packages/web/src/
```

### Step 3: Update Import Paths

After copying, update imports in packages/api/src/:
- `@/polyfill` → `../polyfill` or `@/polyfill`
- `@/db/*` → `../db/*` or `@/db/*`
- `@/server/*` → relative paths within the package
- `@/shared/*` → `@autonome/shared/*`
- `@/core/shared/*` → `@autonome/shared/*`

Update imports in packages/web/src/:
- `@/server/orpc/client` → `../orpc/client` or `@/orpc/client`
- `@/shared/*` → `@autonome/shared/*`
- `@/core/shared/*` → `@autonome/shared/*`

### Step 4: Remove SSR Loaders from Route Files

In each route file (index.tsx, analytics.tsx, etc.), remove the `loader` function:

```tsx
// Before
export const Route = createFileRoute("/")({
  component: DashboardRoute,
  loader: async ({ context }) => {
    // ... prefetch logic
  },
});

// After
export const Route = createFileRoute("/")({
  component: DashboardRoute,
});
```

### Step 5: Update __root.tsx

Remove the server-side scheduler bootstrap:

```tsx
// Remove this block from beforeLoad:
if (typeof window === "undefined") {
  const { bootstrapSchedulers } = await import("@/server/schedulers/bootstrap");
  await bootstrapSchedulers();
}
```

### Step 6: Install Dependencies

```bash
cd packages/shared && bun install
cd packages/api && bun install
cd packages/web && bun install
cd ../.. && bun install
```

### Step 7: Environment Configuration

Create `.env` files:

**packages/api/.env:**
```
PORT=3001
HOST=0.0.0.0
CORS_ORIGINS=http://localhost:5173,https://yourdomain.com
DATABASE_URL=postgresql://...
NIM_API_KEY=...
OPENROUTER_API_KEY=...
MISTRAL_API_KEY=...
TRADING_MODE=simulated
```

**packages/web/.env:**
```
VITE_API_URL=http://localhost:3001
VITE_APP_TITLE=Autonome
```

### Step 8: Run Development Servers

```bash
# Terminal 1: API server
bun run dev:api

# Terminal 2: Frontend
bun run dev:web
```

## Deployment

### Frontend (Vercel/Netlify)

1. Set build command: `cd packages/web && bun run build`
2. Set output directory: `packages/web/dist`
3. Set environment variables:
   - `VITE_API_URL=https://api.yourdomain.com`

### Backend (VPS)

1. Build: `cd packages/api && bun run build`
2. Run: `bun run start:api`
3. Use PM2 or systemd for process management
4. Set up nginx for reverse proxy and SSL

## Notes

- The legacy `src/` directory can be removed after migration is complete
- Docker configuration may need updates for the new structure
- Database migrations remain in the root `drizzle/` directory
