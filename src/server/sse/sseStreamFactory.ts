/**
 * Factory functions for creating Server-Sent Events (SSE) streams.
 * Reduces duplication across event endpoints by centralizing:
 * - Cache hydration logic
 * - Heartbeat/ping intervals
 * - Cleanup and abort handling
 * - Stream encoding and error handling
 */

const SSE_HEADERS = {
	"Content-Type": "text/event-stream",
	"Cache-Control": "no-store",
	Connection: "keep-alive",
} as const;

const DEFAULT_CACHE_TTL_MS = 60_000; // 1 minute
const DEFAULT_HEARTBEAT_MS = 15_000; // 15 seconds

type EventData = unknown;
type UnsubscribeFn = () => void;
type SubscribeFn = (
	listener: (event: { data: EventData }) => void,
) => UnsubscribeFn;

interface CacheMetadata {
	count: number;
	lastUpdatedAt: number | null;
}

interface SseStreamConfig<T = EventData> {
	/** Name for logging purposes (e.g., "trades", "positions") */
	name: string;
	/** Function to get current cached data for initial SSE payload */
	getCurrentData: () => T;
	/** Function to subscribe to real-time updates */
	subscribe: SubscribeFn;
	/** Function to get cache metadata for staleness check */
	getCacheMetadata: () => CacheMetadata;
	/**
	 * API path to hydrate cache if stale (e.g., "/api/trades?hydrate=sse").
	 * Ignored when a custom hydrate handler is provided.
	 */
	hydrateApiPath?: string;
	/**
	 * Optional custom hydrate callback. When provided, it is responsible for
	 * bringing the cache up to date before the stream starts.
	 */
	hydrate?: (request: Request) => Promise<void> | void;
	/** Cache TTL in milliseconds (default: 60s) */
	cacheTtlMs?: number;
	/** Heartbeat interval in milliseconds (default: 15s) */
	heartbeatMs?: number;
}

/**
 * Hydrates the cache if it's stale by fetching from the hydration endpoint.
 * Uses a singleton promise to prevent concurrent hydration requests.
 */
function createCacheHydrator(
	name: string,
	getCacheMetadata: () => CacheMetadata,
	hydrateApiPath: string,
	cacheTtlMs: number,
) {
	let pendingHydration: Promise<void> | null = null;

	return async (request: Request): Promise<void> => {
		const { count, lastUpdatedAt } = getCacheMetadata();
		const isStale =
			count === 0 ||
			lastUpdatedAt == null ||
			Date.now() - lastUpdatedAt > cacheTtlMs;

		if (!isStale) {
			return;
		}

		if (pendingHydration) {
			return pendingHydration;
		}

		const origin = new URL(request.url).origin;
		const hydrateUrl = new URL(hydrateApiPath, origin);

		pendingHydration = fetch(hydrateUrl, {
			cache: "no-store",
			headers: {
				"x-autonome-sse": `hydrate-${name}`,
			},
		})
			.then(() => undefined)
			.catch((error) => {
				console.error(`[SSE][${name}] Failed to hydrate cache`, error);
			})
			.finally(() => {
				pendingHydration = null;
			});

		return pendingHydration;
	};
}

/**
 * Creates a standardized SSE stream handler for data endpoints.
 * Handles cache hydration, initial data send, heartbeat, updates, and cleanup.
 *
 * @example
 * ```ts
 * const handleGet = createSseDataStream({
 *   name: 'trades',
 *   getCurrentData: getCurrentTrades,
 *   subscribe: subscribeToTradeEvents,
 *   getCacheMetadata: getTradeCacheMetadata,
 *   hydrateApiPath: '/api/trades?hydrate=sse',
 *   // or hydrate: (request) => customHydrator(request),
 * });
 *
 * export const Route = createFileRoute('/api/events/trades')({
 *   server: { handlers: { GET: handleGet } },
 * });
 * ```
 */
export function createSseDataStream<T = EventData>(
	config: SseStreamConfig<T>,
): (context: { request: Request }) => Response {
	const {
		name,
		getCurrentData,
		subscribe,
		getCacheMetadata,
		hydrateApiPath,
		hydrate,
		cacheTtlMs = DEFAULT_CACHE_TTL_MS,
		heartbeatMs = DEFAULT_HEARTBEAT_MS,
	} = config;

	const hydrateCache =
		typeof hydrate === "function"
			? hydrate
			: hydrateApiPath
				? createCacheHydrator(
						name,
						getCacheMetadata,
						hydrateApiPath,
						cacheTtlMs,
					)
				: async () => undefined;

	return ({ request }: { request: Request }) => {
		const encoder = new TextEncoder();
		let cleanup: (() => void) | null = null;

		const stream = new ReadableStream<Uint8Array>({
			async start(controller) {
				let closed = false;

				// Hydrate cache if stale
				await hydrateCache(request);

				// Send initial data
				const initialData = getCurrentData();
				controller.enqueue(
					encoder.encode(`data: ${JSON.stringify(initialData)}\n\n`),
				);

				// Heartbeat to keep connection alive
				const ping = setInterval(() => {
					if (closed) return;
					try {
						controller.enqueue(encoder.encode("event: ping\n\n"));
					} catch {
						// Connection might be closed
					}
				}, heartbeatMs);

				// Subscribe to real-time updates
				const unsubscribe = subscribe((event) => {
					if (closed) return;
					try {
						controller.enqueue(
							encoder.encode(`data: ${JSON.stringify(event.data)}\n\n`),
						);
					} catch {
						// Connection might be closed
					}
				});

				// Cleanup function
				const abort = () => {
					if (closed) return;
					closed = true;
					controller.close();
					cleanup?.();
					cleanup = null;
				};

				cleanup = () => {
					closed = true;
					clearInterval(ping);
					unsubscribe();
					request.signal.removeEventListener("abort", abort);
				};

				request.signal.addEventListener("abort", abort);
			},
			cancel() {
				cleanup?.();
				cleanup = null;
			},
		});

		return new Response(stream, { headers: SSE_HEADERS });
	};
}

/**
 * Creates a simple SSE stream for generic event broadcasting.
 * No cache hydration or initial data - just real-time events and heartbeat.
 *
 * @example
 * ```ts
 * const handleGet = createSseEventStream({
 *   name: 'trading',
 *   subscribe: subscribeToTradingEvents,
 *   eventName: 'trading-update',
 *   sendConnectedEvent: true,
 * });
 * ```
 */
export function createSseEventStream(config: {
	name: string;
	subscribe: (listener: (event: unknown) => void) => UnsubscribeFn;
	eventName?: string;
	sendConnectedEvent?: boolean;
	heartbeatMs?: number;
}): (context: { request: Request }) => Response {
	const {
		name,
		subscribe,
		eventName,
		sendConnectedEvent = false,
		heartbeatMs = DEFAULT_HEARTBEAT_MS,
	} = config;

	return ({ request }: { request: Request }) => {
		const encoder = new TextEncoder();
		let cleanup: (() => void) | null = null;

		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				let closed = false;

				const send = (event: unknown) => {
					if (closed) return;
					try {
						const prefix = eventName ? `event: ${eventName}\n` : "";
						controller.enqueue(
							encoder.encode(`${prefix}data: ${JSON.stringify(event)}\n\n`),
						);
					} catch (error) {
						console.error(`[SSE][${name}] Failed to send event`, error);
					}
				};

				// Subscribe to updates
				const unsubscribe = subscribe(send);

				// Heartbeat
				const heartbeat = setInterval(() => {
					if (closed) return;
					controller.enqueue(encoder.encode(": heartbeat\n\n"));
				}, heartbeatMs);

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

				// Send initial connected event if configured
				if (sendConnectedEvent) {
					send({ type: "connected", timestamp: new Date().toISOString() });
				}
			},
			cancel() {
				cleanup?.();
				cleanup = null;
			},
		});

		return new Response(stream, { headers: SSE_HEADERS });
	};
}
