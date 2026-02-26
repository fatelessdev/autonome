/**
 * SSE Stream Handler Factory
 *
 * Encapsulates the repetitive lifecycle for all SSE endpoints:
 *   1. Optional async hydration (populate cache before first send)
 *   2. Send initial data on connection
 *   3. Subscribe to event bus updates → forward to stream
 *   4. Heartbeat to keep the connection alive through proxies
 *   5. Cleanup (unsubscribe + cancel heartbeat) on client disconnect
 *   6. Keep-alive indefinite promise
 *
 * Usage:
 *   app.get("/api/events/dashboard", createSseHandler({ ... }));
 */

import type { Context } from "hono";
import { streamSSE } from "hono/streaming";

const DEFAULT_HEARTBEAT_MS = 15_000;

interface SseHandlerConfig<TEvent> {
	/**
	 * Optional async step to populate the in-memory cache before sending the
	 * initial payload. Runs once per client connection.
	 */
	hydrate?: () => Promise<void>;
	/** Returns the SSE message object to send immediately on connection. */
	getInitialMessage: () => { event?: string; data: string };
	/** Subscribe to event bus updates. Returns an unsubscribe function. */
	subscribe: (listener: (event: TEvent) => void) => () => void;
	/** Convert a bus event into an SSE message object. */
	toSseMessage: (event: TEvent) => { event?: string; data: string };
	/** Heartbeat interval in ms. Defaults to 15 000. */
	heartbeatMs?: number;
	/** Heartbeat message. Defaults to `{ event: "ping", data: "" }`. */
	heartbeatMessage?: { event?: string; data: string };
}

export function createSseHandler<TEvent>(config: SseHandlerConfig<TEvent>) {
	return (c: Context) =>
		streamSSE(c, async (stream) => {
			if (config.hydrate) {
				await config.hydrate();
			}

			const initial = config.getInitialMessage();
			await stream.writeSSE(initial);

			const unsubscribe = config.subscribe((event) => {
				stream.writeSSE(config.toSseMessage(event));
			});

			const heartbeatMsg = config.heartbeatMessage ?? {
				event: "ping",
				data: "",
			};
			const heartbeat = setInterval(() => {
				stream.writeSSE(heartbeatMsg);
			}, config.heartbeatMs ?? DEFAULT_HEARTBEAT_MS);

			stream.onAbort(() => {
				clearInterval(heartbeat);
				unsubscribe();
			});

			// Keep stream open until the client disconnects
			await new Promise(() => {});
		});
}
