/**
 * Workflow Events SSE Endpoint
 *
 * Single SSE endpoint for all trading workflow notifications.
 * Clients connect once and receive events when data changes.
 *
 * Event flow:
 * 1. Client connects → receives "connected" event
 * 2. AI workflow runs → positions/trades/conversations created/updated
 * 3. Workflow completes → emitAllDataChanged() called
 * 4. Client receives events → invalidates TanStack Query caches → refetches via oRPC
 *
 * This replaces the previous architecture of separate SSE endpoints per data type.
 */

import { createFileRoute } from "@tanstack/react-router";
import {
	subscribeToWorkflowEvents,
	type WorkflowEvent,
} from "@/server/events/workflowEvents";

const SSE_HEADERS = {
	"Content-Type": "text/event-stream",
	"Cache-Control": "no-store",
	Connection: "keep-alive",
} as const;

const HEARTBEAT_MS = 30_000; // 30 seconds

function handleGet({ request }: { request: Request }): Response {
	const encoder = new TextEncoder();
	let cleanup: (() => void) | null = null;

	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			let closed = false;

			const send = (event: WorkflowEvent) => {
				if (closed) return;
				try {
					const eventType = event.type;
					controller.enqueue(
						encoder.encode(
							`event: ${eventType}\ndata: ${JSON.stringify(event)}\n\n`,
						),
					);
				} catch {
					// Connection closed
				}
			};

			// Subscribe to workflow events
			const unsubscribe = subscribeToWorkflowEvents(send);

			// Heartbeat to keep connection alive
			const heartbeat = setInterval(() => {
				if (closed) return;
				try {
					controller.enqueue(encoder.encode(": heartbeat\n\n"));
				} catch {
					// Connection closed
				}
			}, HEARTBEAT_MS);

			// Abort handler
			const abort = () => {
				if (closed) return;
				closed = true;
				controller.close();
				cleanup?.();
				cleanup = null;
			};

			cleanup = () => {
				closed = true;
				clearInterval(heartbeat);
				unsubscribe();
				request.signal.removeEventListener("abort", abort);
			};

			request.signal.addEventListener("abort", abort);

			// Send connected event
			send({
				type: "connected",
				timestamp: new Date().toISOString(),
			});
		},
		cancel() {
			cleanup?.();
			cleanup = null;
		},
	});

	return new Response(stream, { headers: SSE_HEADERS });
}

export const Route = createFileRoute("/api/events/workflow")({
	server: {
		handlers: {
			GET: handleGet,
		},
	},
});
