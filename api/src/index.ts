/**
 * Autonome API Server
 *
 * Standalone Hono backend for VPS deployment.
 * The frontend (TanStack Start) communicates with this via oRPC over HTTP.
 */

import { existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { RPCHandler } from "@orpc/server/fetch";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

import "@/polyfill";

import { start } from "workflow/api";
import { getWorld } from "workflow/runtime";
import { env } from "@/env";
import { subscribeToWorkflowEvents } from "@/server/events/workflowEvents";
import { subscribeToPortfolioEvents } from "@/server/features/portfolio/events/portfolioEvents";
import { subscribeToConversationEvents } from "@/server/features/trading/events/conversationEvents";
import { subscribeToPositionEvents } from "@/server/features/trading/events/positionEvents";
import { subscribeToTradeEvents } from "@/server/features/trading/events/tradeEvents";
import router from "@/server/orpc/router";
import { createSseHandler } from "./sse";

type DashboardEventType =
	| "positions:changed"
	| "trades:changed"
	| "conversations:changed"
	| "portfolio:changed"
	| "connected";

type DashboardEvent = {
	type: DashboardEventType;
	timestamp: string;
};

function subscribeToDashboardEvents(
	listener: (event: DashboardEvent) => void,
): () => void {
	const now = () => new Date().toISOString();
	const unsubscribes = [
		subscribeToPositionEvents(() => {
			listener({ type: "positions:changed", timestamp: now() });
		}),
		subscribeToTradeEvents(() => {
			listener({ type: "trades:changed", timestamp: now() });
		}),
		subscribeToConversationEvents(() => {
			listener({ type: "conversations:changed", timestamp: now() });
		}),
		subscribeToPortfolioEvents(() => {
			listener({ type: "portfolio:changed", timestamp: now() });
		}),
	];

	return () => {
		for (const unsubscribe of unsubscribes) {
			unsubscribe();
		}
	};
}

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

// ==================== Workflow DevKit Routes ====================
// The Vite workflow() plugin compiles "use workflow"/"use step" directives into
// deploy-target-specific function bundles. The local world POSTs execution
// requests to these /.well-known/ routes. We mount the compiled handlers here so
// the API server can process workflow and step executions.

// Dynamic imports for compiled workflow handlers.
// Root cause note:
// Bun caches ESM modules by import specifier. When workflow bundles are rebuilt
// after file renames/refactors, a static specifier can keep serving stale code.
// We resolve by loading from file URL with mtime cache-busting and waiting for
// bundles to exist before first use/startup.
const require = createRequire(import.meta.url);

const LEGACY_WORKFLOW_DIR = join(
	process.cwd(),
	"node_modules",
	".nitro",
	"workflow",
);
const WORKFLOW_BUNDLE_CANDIDATES = {
	flow: [
		join(LEGACY_WORKFLOW_DIR, "workflows.mjs"),
		join(
			process.cwd(),
			".vercel",
			"output",
			"functions",
			".well-known",
			"workflow",
			"v1",
			"flow.func",
			"index.js",
		),
	],
	step: [
		join(LEGACY_WORKFLOW_DIR, "steps.mjs"),
		join(
			process.cwd(),
			".vercel",
			"output",
			"functions",
			".well-known",
			"workflow",
			"v1",
			"step.func",
			"index.js",
		),
	],
	webhook: [
		join(LEGACY_WORKFLOW_DIR, "webhook.mjs"),
		join(
			process.cwd(),
			".vercel",
			"output",
			"functions",
			".well-known",
			"workflow",
			"v1",
			"webhook",
			"[token].func",
			"index.js",
		),
	],
} as const;

type WorkflowBundleKind = keyof typeof WORKFLOW_BUNDLE_CANDIDATES;

function findWorkflowBundle(kind: WorkflowBundleKind): string | null {
	return (
		WORKFLOW_BUNDLE_CANDIDATES[kind].find((file) => existsSync(file)) ?? null
	);
}

async function sleep(ms: number): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForWorkflowBundles(timeoutMs = 20_000): Promise<void> {
	const start = Date.now();
	while (true) {
		if (
			findWorkflowBundle("flow") &&
			findWorkflowBundle("step") &&
			findWorkflowBundle("webhook")
		) {
			return;
		}

		if (Date.now() - start > timeoutMs) {
			throw new Error(
				`Workflow bundles not ready in ${timeoutMs}ms. Checked legacy dir ${LEGACY_WORKFLOW_DIR} and .vercel output functions.`,
			);
		}

		await sleep(200);
	}
}

async function importFreshWorkflowModule<T>(filePath: string): Promise<T> {
	const mtimeMs = statSync(filePath).mtimeMs;
	if (filePath.endsWith(".js")) {
		const resolved = require.resolve(filePath);
		delete require.cache[resolved];
		return require(resolved) as T;
	}

	const fileUrl = pathToFileURL(filePath).href;
	const specifier = `${fileUrl}?t=${mtimeMs}`;

	return import(specifier) as Promise<T>;
}

async function loadWorkflowModule<T>(kind: WorkflowBundleKind): Promise<T> {
	await waitForWorkflowBundles();
	const filePath = findWorkflowBundle(kind);
	if (!filePath) {
		throw new Error(`Workflow ${kind} bundle not found after readiness check`);
	}
	return importFreshWorkflowModule<T>(filePath);
}

const loadWorkflowFlowHandler = async () => {
	const module = await loadWorkflowModule<{ POST: typeof fetch }>("flow");
	return module.POST;
};

const loadWorkflowStepHandler = async () => {
	const module = await loadWorkflowModule<{ POST: typeof fetch }>("step");
	return module.POST;
};

const loadWebhookHandlers = async () => {
	const module = await loadWorkflowModule<{
		POST: typeof fetch;
		GET: typeof fetch;
	}>("webhook");
	return { POST: module.POST, GET: module.GET };
};

// GET handler for health checks — Hono auto-handles HEAD for GET routes,
// so the local world's HEAD ?__health probes will return 200.
app.get("/.well-known/workflow/v1/flow", (c) => c.body(null, 200));

app.post("/.well-known/workflow/v1/flow", async (c) => {
	const handler = await loadWorkflowFlowHandler();
	return handler(c.req.raw);
});

app.post("/.well-known/workflow/v1/step", async (c) => {
	const handler = await loadWorkflowStepHandler();
	return handler(c.req.raw);
});

app.all("/.well-known/workflow/v1/webhook/:token", async (c) => {
	const { POST, GET } = await loadWebhookHandlers();
	const handler = c.req.method === "GET" ? GET : POST;
	return handler(c.req.raw);
});

// ==================== SSE Endpoints ====================

app.get(
	"/api/events/workflow",
	createSseHandler({
		getInitialMessage: () => ({
			event: "connected",
			data: JSON.stringify({
				type: "connected",
				timestamp: new Date().toISOString(),
			}),
		}),
		subscribe: subscribeToWorkflowEvents,
		toSseMessage: (event) => ({
			event: event.type,
			data: JSON.stringify(event),
		}),
		heartbeatMs: 30_000,
		heartbeatMessage: { data: "" },
	}),
);

app.get(
	"/api/events/dashboard",
	createSseHandler({
		getInitialMessage: () => ({
			data: JSON.stringify({
				type: "connected",
				timestamp: new Date().toISOString(),
			}),
		}),
		subscribe: subscribeToDashboardEvents,
		toSseMessage: (event) => ({ data: JSON.stringify(event) }),
	}),
);

// ==================== Health Check ====================

app.get("/health", (c) =>
	c.json({ status: "ok", timestamp: new Date().toISOString() }),
);
app.get("/api/health", (c) =>
	c.json({ status: "ok", timestamp: new Date().toISOString() }),
);

app.get("/", (c) => {
	return c.json({
		name: "Autonome API",
		version: "2.0.0",
		broker: "alpaca",
		endpoints: [
			"/api/rpc/*",
			"/api/events/dashboard",
			"/api/events/workflow",
			"/health",
		],
	});
});

// ==================== Start Server ====================

const port = env.API_PORT;

/**
 * Workflow metadata for the trade cycle.
 * The API server runs via `bun --hot` (no Vite), so `"use workflow"` directives
 * aren't compiled here. We pass the pre-compiled workflowId directly instead.
 * This ID is generated by the Workflow DevKit Vite plugin (see manifest.json).
 */
const TRADE_CYCLE_WORKFLOW = {
	workflowId: "workflow//./src/server/workflows/tradeCycle//tradeCycleWorkflow",
};

async function main() {
	console.log("🚀 Starting Autonome API server...");

	await waitForWorkflowBundles();

	// Start the Workflow DevKit world (connects to queue backend, begins processing)
	const world = getWorld();
	if (world.start) {
		await world.start();
		console.log("✅ Workflow world started");
	}

	// Start the trade cycle workflow (idempotent — if already running, this is a no-op)
	try {
		await start(TRADE_CYCLE_WORKFLOW);
		console.log("✅ Trade cycle workflow started");
	} catch (error) {
		// If the workflow is already running, this is expected
		console.log(
			"ℹ️ Trade cycle workflow:",
			error instanceof Error ? error.message : String(error),
		);
	}

	console.log(`✅ API server running on http://localhost:${port}`);
}

main().catch(console.error);

export default {
	port,
	idleTimeout: 120, // seconds — Bun default is 10s, SSE needs much longer
	fetch: app.fetch,
};
