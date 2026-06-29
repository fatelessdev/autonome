FROM oven/bun:1 AS builder

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .

# The frontend build generates the Workflow DevKit handlers consumed by the API.
RUN bun run build
RUN bun run build:api

FROM oven/bun:1 AS runner

WORKDIR /app

RUN groupadd --system --gid 1001 nodejs \
	&& useradd --system --uid 1001 --gid nodejs bunjs

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY --from=builder --chown=bunjs:nodejs /app/dist/api ./dist/api
COPY --from=builder --chown=bunjs:nodejs /app/.vercel ./.vercel
COPY --from=builder --chown=bunjs:nodejs /app/api ./api
COPY --from=builder --chown=bunjs:nodejs /app/drizzle ./drizzle
COPY --from=builder --chown=bunjs:nodejs /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=builder --chown=bunjs:nodejs /app/scripts ./scripts
COPY --from=builder --chown=bunjs:nodejs /app/src ./src
COPY --from=builder --chown=bunjs:nodejs /app/tsconfig.json ./tsconfig.json

RUN mkdir -p /app/.workflow-data && chown bunjs:nodejs /app/.workflow-data

USER bunjs

ENV API_PORT=8081
EXPOSE 8081

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
	CMD bun -e "if ((await fetch('http://127.0.0.1:8081/health')).status !== 200) process.exit(1)"

CMD ["bun", "--bun", "run", "api/src/index.ts"]
