/**
 * Autonome API Server
 * 
 * Standalone Hono backend for VPS deployment.
 * The frontend (TanStack Start) communicates with this via oRPC over HTTP.
 */

import "@/polyfill";

import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { streamSSE } from "hono/streaming";
import { RPCHandler } from "@orpc/server/fetch";

import router from "@/server/orpc/router";
import { bootstrapSchedulers } from "@/server/schedulers/bootstrap";
import { subscribeToWorkflowEvents } from "@/server/events/workflowEvents";
import {
	getCurrentPositions,
	subscribeToPositionEvents,
	emitPositionEvent,
	type PositionEventData,
} from "@/server/features/trading/events/positionEvents";
import {
	getCurrentTrades,
	subscribeToTradeEvents,
	emitTradeEvent,
	type TradeEventData,
} from "@/server/features/trading/events/tradeEvents";
import {
	getCurrentConversations,
	subscribeToConversationEvents,
	emitConversationEvent,
	type ConversationEventData,
} from "@/server/features/trading/events/conversationEvents";
import {
	getCurrentPortfolioSummary,
	subscribeToPortfolioEvents,
	emitPortfolioEvent,
} from "@/server/features/portfolio/events/portfolioEvents";
import { fetchPositions, fetchTrades } from "@/server/features/trading/queries.server";
import { refreshConversationEvents } from "@/server/features/trading/conversationsSnapshot.server";

// ==================== Server Setup ====================

const app = new Hono();

// Middleware
app.use("*", logger());
app.use(
	"*",
	cors({
		origin: (origin) => {
			// Allow localhost for development
			if (!origin || origin.includes("localhost") || origin.includes("127.0.0.1")) {
				return origin || "*";
			}
			// In production, configure allowed origins
			const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(",") || [];
			return allowedOrigins.includes(origin) ? origin : "";
		},
		allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"],
		allowHeaders: ["Content-Type", "Authorization"],
		credentials: true,
	})
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
		await stream.writeSSE({ data: JSON.stringify(getCurrentPortfolioSummary()) });

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
			data: JSON.stringify({ type: "connected", timestamp: new Date().toISOString() }),
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

app.get("/health", (c) => {
	return c.json({ status: "ok", timestamp: new Date().toISOString() });
});

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
		],
	});
});

// ==================== Start Server ====================

const port = Number(process.env.PORT) || 8080;

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
