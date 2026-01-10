/**
 * Autonome API Server
 *
 * Standalone Hono backend for VPS deployment.
 * The frontend (TanStack Start) communicates with this via oRPC over HTTP.
 */

import { RPCHandler } from "@orpc/server/fetch";
import { type Context, Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { streamSSE } from "hono/streaming";

import "@/polyfill";

import { env } from "@/env";
import { subscribeToWorkflowEvents } from "@/server/events/workflowEvents";
import {
	emitPortfolioEvent,
	getCurrentPortfolioSummary,
	subscribeToPortfolioEvents,
} from "@/server/features/portfolio/events/portfolioEvents";
import { refreshConversationEvents } from "@/server/features/trading/conversationsSnapshot.server";
import {
	type ConversationEventData,
	emitConversationEvent,
	getCurrentConversations,
	subscribeToConversationEvents,
} from "@/server/features/trading/events/conversationEvents";
import {
	emitPositionEvent,
	getCurrentPositions,
	type PositionEventData,
	subscribeToPositionEvents,
} from "@/server/features/trading/events/positionEvents";
import {
	emitTradeEvent,
	getCurrentTrades,
	subscribeToTradeEvents,
	type TradeEventData,
} from "@/server/features/trading/events/tradeEvents";
import {
	fetchPositions,
	fetchTrades,
} from "@/server/features/trading/queries.server";
import router from "@/server/orpc/router";
import { bootstrapSchedulers } from "@/server/schedulers/bootstrap";

// ==================== Global Error Handlers ====================
// Prevent unhandled errors from silently crashing schedulers

process.on("unhandledRejection", (reason, promise) => {
	console.error("[CRITICAL] Unhandled Promise Rejection:", reason);
	console.error("Promise:", promise);
});

process.on("uncaughtException", (error) => {
	console.error("[CRITICAL] Uncaught Exception:", error);
	// Don't exit - keep the server running
});

// Track server start time for uptime calculation
globalThis.__serverStartTime = Date.now();

// ==================== Server Setup ====================

const app = new Hono();

// Middleware
app.use("*", logger());
app.use(
	"*",
	cors({
		origin: (origin) => {
			// Allow localhost for development
			if (
				!origin ||
				origin.includes("localhost") ||
				origin.includes("127.0.0.1")
			) {
				return origin || "*";
			}
			// In production, configure allowed origins
			const allowedOrigins = env.CORS_ORIGINS?.split(",") ?? [];
			return allowedOrigins.includes(origin) ? origin : "";
		},
		allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"],
		allowHeaders: ["Content-Type", "Authorization"],
		credentials: true,
	}),
);

// ==================== oRPC Handler ====================

const rpcHandler = new RPCHandler(router);

app.all("/api/rpc/*", async (c) => {
	const { response } = await rpcHandler.handle(c.req.raw, {
		prefix: "/api/rpc",
		context: {},
	});
	return response ?? c.json({ error: "Not Found" }, 404);
});

// ==================== SSE Endpoints ====================

const HEARTBEAT_MS = 15_000;

app.get("/api/events/positions", async (c) => {
	return streamSSE(c, async (stream) => {
		// Hydrate cache
		const positions = await fetchPositions();
		emitPositionEvent({
			type: "positions:updated",
			timestamp: new Date().toISOString(),
			data: positions as PositionEventData[],
		});

		// Send initial data
		await stream.writeSSE({ data: JSON.stringify(getCurrentPositions()) });

		// Subscribe to updates
		const unsubscribe = subscribeToPositionEvents((event) => {
			stream.writeSSE({ data: JSON.stringify(event.data) });
		});

		// Heartbeat
		const heartbeat = setInterval(() => {
			stream.writeSSE({ event: "ping", data: "" });
		}, HEARTBEAT_MS);

		// Wait for abort
		stream.onAbort(() => {
			clearInterval(heartbeat);
			unsubscribe();
		});

		// Keep stream alive
		await new Promise(() => {});
	});
});

app.get("/api/events/trades", async (c) => {
	return streamSSE(c, async (stream) => {
		// Hydrate cache
		const trades = await fetchTrades();
		emitTradeEvent({
			type: "trades:updated",
			timestamp: new Date().toISOString(),
			data: trades as unknown as TradeEventData[],
		});

		// Send initial data
		await stream.writeSSE({ data: JSON.stringify(getCurrentTrades()) });

		// Subscribe to updates
		const unsubscribe = subscribeToTradeEvents((event) => {
			stream.writeSSE({ data: JSON.stringify(event.data) });
		});

		// Heartbeat
		const heartbeat = setInterval(() => {
			stream.writeSSE({ event: "ping", data: "" });
		}, HEARTBEAT_MS);

		// Wait for abort
		stream.onAbort(() => {
			clearInterval(heartbeat);
			unsubscribe();
		});

		// Keep stream alive
		await new Promise(() => {});
	});
});

app.get("/api/events/conversations", async (c) => {
	return streamSSE(c, async (stream) => {
		// Hydrate cache
		const conversations = await refreshConversationEvents();
		emitConversationEvent({
			type: "conversations:updated",
			timestamp: new Date().toISOString(),
			data: conversations as ConversationEventData[],
		});

		// Send initial data
		await stream.writeSSE({ data: JSON.stringify(getCurrentConversations()) });

		// Subscribe to updates
		const unsubscribe = subscribeToConversationEvents((event) => {
			stream.writeSSE({ data: JSON.stringify(event.data) });
		});

		// Heartbeat
		const heartbeat = setInterval(() => {
			stream.writeSSE({ event: "ping", data: "" });
		}, HEARTBEAT_MS);

		// Wait for abort
		stream.onAbort(() => {
			clearInterval(heartbeat);
			unsubscribe();
		});

		// Keep stream alive
		await new Promise(() => {});
	});
});

app.get("/api/events/portfolio", async (c) => {
	return streamSSE(c, async (stream) => {
		// Emit initial event
		emitPortfolioEvent({
			type: "portfolio:updated",
			timestamp: new Date().toISOString(),
			data: { modelsUpdated: 0, snapshotsCreated: 0 },
		});

		// Send initial data
		await stream.writeSSE({
			data: JSON.stringify(getCurrentPortfolioSummary()),
		});

		// Subscribe to updates
		const unsubscribe = subscribeToPortfolioEvents((event) => {
			stream.writeSSE({ data: JSON.stringify(event.data) });
		});

		// Heartbeat
		const heartbeat = setInterval(() => {
			stream.writeSSE({ event: "ping", data: "" });
		}, HEARTBEAT_MS);

		// Wait for abort
		stream.onAbort(() => {
			clearInterval(heartbeat);
			unsubscribe();
		});

		// Keep stream alive
		await new Promise(() => {});
	});
});

app.get("/api/events/workflow", async (c) => {
	return streamSSE(c, async (stream) => {
		// Send connected event
		await stream.writeSSE({
			event: "connected",
			data: JSON.stringify({
				type: "connected",
				timestamp: new Date().toISOString(),
			}),
		});

		// Subscribe to workflow events
		const unsubscribe = subscribeToWorkflowEvents((event) => {
			stream.writeSSE({
				event: event.type,
				data: JSON.stringify(event),
			});
		});

		// Heartbeat
		const heartbeat = setInterval(() => {
			stream.writeSSE({ data: "" });
		}, 30_000);

		// Wait for abort
		stream.onAbort(() => {
			clearInterval(heartbeat);
			unsubscribe();
		});

		// Keep stream alive
		await new Promise(() => {});
	});
});

// ==================== Health Check ====================

// Health handler function (reused for both paths)
const healthHandler = (c: Context) => {
	// Include scheduler health information
	const now = Date.now();
	const tradeSchedulerLastRun = globalThis.tradeSchedulerLastRun;
	const portfolioSchedulerLastRun = globalThis.__portfolioSchedulerLastRun;
	const serverStartTime = globalThis.__serverStartTime ?? now;
	const lastSuccessfulCompletion = globalThis.tradeSchedulerLastSuccessfulCompletion;
	const lastCycleStats = globalThis.tradeSchedulerLastCycleStats;
	const consecutiveFailedCycles = globalThis.tradeSchedulerConsecutiveFailedCycles ?? 0;

	// Check if schedulers have run recently (within 2x their interval)
	const TRADE_INTERVAL_MS = 5 * 60 * 1000;
	const PORTFOLIO_INTERVAL_MS = 1 * 60 * 1000;

	// Trade scheduler is "running" if interval is active and ran recently
	const tradeSchedulerRunning = tradeSchedulerLastRun
		? now - tradeSchedulerLastRun < TRADE_INTERVAL_MS * 2
		: false;

	// Trade scheduler is "healthy" only if models are actually completing successfully
	// - Must have had a successful completion in the last 15 minutes (3 cycles)
	// - OR be a fresh server with no cycles completed yet (give it grace period)
	const MAX_SUCCESS_AGE_MS = 15 * 60 * 1000; // 15 minutes
	const isNewServer = !lastCycleStats && now - serverStartTime < TRADE_INTERVAL_MS * 2;
	const hasRecentSuccess = lastSuccessfulCompletion
		? now - lastSuccessfulCompletion < MAX_SUCCESS_AGE_MS
		: isNewServer;
	const tradeSchedulerHealthy = tradeSchedulerRunning && hasRecentSuccess && consecutiveFailedCycles < 3;

	const portfolioSchedulerHealthy = portfolioSchedulerLastRun
		? now - portfolioSchedulerLastRun < PORTFOLIO_INTERVAL_MS * 2
		: false;

	const allHealthy = tradeSchedulerHealthy && portfolioSchedulerHealthy;
	const uptimeSeconds = Math.floor((now - serverStartTime) / 1000);

	return c.json({
		status: allHealthy ? "ok" : "degraded",
		timestamp: new Date().toISOString(),
		serverStartedAt: new Date(serverStartTime).toISOString(),
		uptimeSeconds,
		schedulers: {
			trade: {
				healthy: tradeSchedulerHealthy,
				lastRun: tradeSchedulerLastRun
					? new Date(tradeSchedulerLastRun).toISOString()
					: null,
				ageMs: tradeSchedulerLastRun ? now - tradeSchedulerLastRun : null,
			},
			portfolio: {
				healthy: portfolioSchedulerHealthy,
				lastRun: portfolioSchedulerLastRun
					? new Date(portfolioSchedulerLastRun).toISOString()
					: null,
				ageMs: portfolioSchedulerLastRun
					? now - portfolioSchedulerLastRun
					: null,
			},
		},
	});
};

app.get("/health", healthHandler);
app.get("/api/health", healthHandler);

// Declare global types for scheduler health
declare global {
	var tradeSchedulerLastRun: number | undefined;
	var __portfolioSchedulerLastRun: number | undefined;
	var __serverStartTime: number | undefined;
	var tradeSchedulerLastSuccessfulCompletion: number | undefined;
	var tradeSchedulerLastCycleStats: {
		successCount: number;
		failureCount: number;
		totalModels: number;
		timestamp: number;
	} | undefined;
	var tradeSchedulerConsecutiveFailedCycles: number | undefined;
}

app.get("/", (c) => {
	return c.json({
		name: "Autonome API",
		version: "1.0.0",
		endpoints: [
			"/api/rpc/*",
			"/api/events/positions",
			"/api/events/trades",
			"/api/events/conversations",
			"/api/events/portfolio",
			"/api/events/workflow",
			"/health",
			"/health/schedulers",
		],
	});
});

// Detailed scheduler health endpoint
const schedulersHealthHandler = (c: Context) => {
	const now = Date.now();
	const tradeSchedulerLastRun = globalThis.tradeSchedulerLastRun;
	const portfolioSchedulerLastRun = globalThis.__portfolioSchedulerLastRun;
	const modelsRunning = globalThis.modelsRunning;
	const modelsRunningStartTime = globalThis.modelsRunningStartTime;
	const serverStartTime = globalThis.__serverStartTime ?? now;
	const lastSuccessfulCompletion = globalThis.tradeSchedulerLastSuccessfulCompletion;
	const lastCycleStats = globalThis.tradeSchedulerLastCycleStats;
	const consecutiveFailedCycles = globalThis.tradeSchedulerConsecutiveFailedCycles ?? 0;

	// Build detailed running models info with duration
	const runningModelsInfo = modelsRunning
		? Array.from(modelsRunning.entries())
				.filter(([_, running]) => running)
				.map(([id]) => ({
					id,
					runningForSeconds: modelsRunningStartTime?.has(id)
						? Math.round((now - (modelsRunningStartTime.get(id) ?? now)) / 1000)
						: null,
				}))
		: [];

	const uptimeSeconds = Math.floor((now - serverStartTime) / 1000);

	return c.json({
		timestamp: new Date().toISOString(),
		serverStartedAt: new Date(serverStartTime).toISOString(),
		uptimeSeconds,
		tradeScheduler: {
			lastRun: tradeSchedulerLastRun
				? new Date(tradeSchedulerLastRun).toISOString()
				: null,
			ageSeconds: tradeSchedulerLastRun
				? Math.round((now - tradeSchedulerLastRun) / 1000)
				: null,
			modelsCurrentlyRunning: runningModelsInfo,
			intervalHandle: Boolean(globalThis.tradeIntervalHandle),
			// New execution health metrics
			lastSuccessfulCompletion: lastSuccessfulCompletion
				? new Date(lastSuccessfulCompletion).toISOString()
				: null,
			lastSuccessAge: lastSuccessfulCompletion
				? Math.round((now - lastSuccessfulCompletion) / 1000)
				: null,
			lastCycleStats: lastCycleStats
				? {
						successCount: lastCycleStats.successCount,
						failureCount: lastCycleStats.failureCount,
						totalModels: lastCycleStats.totalModels,
						timestamp: new Date(lastCycleStats.timestamp).toISOString(),
					}
				: null,
			consecutiveFailedCycles,
		},
		portfolioScheduler: {
			lastRun: portfolioSchedulerLastRun
				? new Date(portfolioSchedulerLastRun).toISOString()
				: null,
			ageSeconds: portfolioSchedulerLastRun
				? Math.round((now - portfolioSchedulerLastRun) / 1000)
				: null,
			intervalHandle: Boolean(globalThis.__portfolioIntervalHandle),
			initialized: Boolean(globalThis.__portfolioSchedulerInitialized),
		},
	});
};

app.get("/health/schedulers", schedulersHealthHandler);
app.get("/api/health/schedulers", schedulersHealthHandler);

// Declare additional global types
declare global {
	var tradeIntervalHandle: ReturnType<typeof setInterval> | undefined;
	var modelsRunning: Map<string, boolean> | undefined;
	var modelsRunningStartTime: Map<string, number> | undefined;
	var __portfolioIntervalHandle: ReturnType<typeof setInterval> | undefined;
	var __portfolioSchedulerInitialized: boolean | undefined;
}

// ==================== Start Server ====================

const port = env.PORT;

async function main() {
	console.log("🚀 Starting Autonome API server...");

	// Bootstrap schedulers (simulator, price tracker, trade executor)
	await bootstrapSchedulers();

	console.log(`✅ API server running on http://localhost:${port}`);
}

main().catch(console.error);

export default {
	port,
	fetch: app.fetch,
};
