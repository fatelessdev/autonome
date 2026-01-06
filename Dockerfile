# Dockerfile.backend
# Specific Dockerfile for the Hono API Backend (VPS)

# ============================================
# Stage 1: Builder
# ============================================
FROM oven/bun:latest AS builder

WORKDIR /app

# Copy package files
COPY package.json bun.lock ./

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source code
COPY . .

# Build the API server
# This bundles the source code (including src/) into api/dist/index.js
# External dependencies (node_modules) are excluded and must be installed in runner
RUN bun run build:api

# ============================================
# Stage 2: Production Runner
# ============================================
FROM oven/bun:latest AS runner

WORKDIR /app

# Create non-root user for security
RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --gid nodejs bunjs

# Copy package files for production install
COPY package.json bun.lock ./

# Install dependencies (includes drizzle-kit for migrations and dotenv for env loading)
RUN bun install --frozen-lockfile

# Copy built API from builder
COPY --from=builder --chown=bunjs:nodejs /app/api/dist ./api/dist

# Copy migrations and database scripts (so you can run migrations on VPS)
COPY --from=builder --chown=bunjs:nodejs /app/drizzle ./drizzle
COPY --from=builder --chown=bunjs:nodejs /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=builder --chown=bunjs:nodejs /app/scripts ./scripts
COPY --from=builder --chown=bunjs:nodejs /app/src/db ./src/db
COPY --from=builder --chown=bunjs:nodejs /app/src/env.ts ./src/env.ts
COPY --from=builder --chown=bunjs:nodejs /app/tsconfig.json ./tsconfig.json

# Create logs directory
RUN mkdir -p /app/logs && chown bunjs:nodejs /app/logs

# Switch to non-root user
USER bunjs

# Expose API port (matches api/src/index.ts default)
ENV PORT=8081
EXPOSE 8081

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8081/health || exit 1

# Start the API server
CMD ["bun", "api/dist/index.js"]
