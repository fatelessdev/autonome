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
import {
	getSchedulerHealth,
	getSchedulerDetailedHealth,
} from "@/server/schedulers/schedulerState";

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
	const health = getSchedulerHealth();
	return c.json(health);
};

app.get("/health", healthHandler);
app.get("/api/health", healthHandler);

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
	const detailedHealth = getSchedulerDetailedHealth();
	return c.json(detailedHealth);
};

app.get("/health/schedulers", schedulersHealthHandler);
app.get("/api/health/schedulers", schedulersHealthHandler);

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
