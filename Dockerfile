# Autonome - AI Cryptocurrency Trading Platform
# Multi-stage Docker build for TanStack Start + Bun

# ============================================
# Stage 1: Dependencies
# ============================================
FROM oven/bun:1.2-alpine AS deps

WORKDIR /app

# Copy package files
COPY package.json bun.lock ./

# Install dependencies
RUN bun install --frozen-lockfile

# ============================================
# Stage 2: Builder
# ============================================
FROM oven/bun:latest AS builder

WORKDIR /app

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy source code
COPY . .

# Build arguments for environment variables needed at build time
# Note: These are placeholder values for build-time only
# Runtime values are set via environment variables
ARG VITE_APP_TITLE=Autonome

# Set environment variables for build
# Use placeholder values that satisfy validation but won't be used at runtime
ENV DATABASE_URL=postgresql://autonome:autonome_secret@db:5432/autonome
ENV NIM_API_KEY=placeholder_nim_key
ENV OPENROUTER_API_KEY=placeholder_openrouter_key
ENV MISTRAL_API_KEY=placeholder_mistral_key
ENV LIGHTER_API_KEY_INDEX=2
ENV LIGHTER_BASE_URL=https://mainnet.zklighter.elliot.ai
ENV TRADING_MODE=simulated
ENV SIM_INITIAL_CAPITAL=10000
ENV SIM_QUOTE_CURRENCY=USDT
ENV SIM_REFRESH_INTERVAL_MS=30000
ENV VITE_APP_TITLE=${VITE_APP_TITLE}

# Disable prerendering during Docker build (no network/DB access)
ENV VITE_PRERENDER_DISABLED=true

# Build the application using the project's build script
RUN bun run build

# ============================================
# Stage 3: Production Runner
# ============================================
FROM oven/bun:latest AS runner

WORKDIR /app

# Create non-root user for security
RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --gid nodejs bunjs

# Copy built output from builder stage (Nitro outputs to .output/)
# .output/public/ contains static assets, .output/server/ contains the server
COPY --from=builder --chown=bunjs:nodejs /app/.output ./.output
COPY --from=builder --chown=bunjs:nodejs /app/package.json ./package.json

# Install only production dependencies
COPY --from=builder /app/node_modules ./node_modules

# Create logs directory
RUN mkdir -p /app/logs && chown bunjs:nodejs /app/logs

# Switch to non-root user
USER bunjs

# Expose port
EXPOSE 3000

# Set runtime environment variables (can be overridden)
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/ || exit 1

# Start the application and log all output to file
CMD ["sh", "-c", "bun run start 2>&1 | tee /app/logs/log.txt"]
