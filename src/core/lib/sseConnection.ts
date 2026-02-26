/**
 * SSE Connection Utility
 *
 * Creates a shared EventSource per URL so multiple consumers on the same page
 * can reuse one underlying network connection.
 *
 * Native EventSource reconnection behavior is used as-is.
 */

export interface SseConnectionOptions {
	/** Full URL of the SSE endpoint. */
	url: string;
	/** Called on every incoming message event. */
	onMessage: (event: MessageEvent) => void;
	/** Optional: called once the connection opens (or re-opens). */
	onOpen?: () => void;
}

type Subscriber = {
	onMessage: (event: MessageEvent) => void;
	onOpen?: () => void;
};

type SharedConnection = {
	source: EventSource;
	subscribers: Set<Subscriber>;
};

const sharedConnections = new Map<string, SharedConnection>();

function createSharedConnection(url: string): SharedConnection {
	const source = new EventSource(url);
	const subscribers = new Set<Subscriber>();

	source.onopen = () => {
		for (const subscriber of subscribers) {
			subscriber.onOpen?.();
		}
	};

	source.onmessage = (event) => {
		for (const subscriber of subscribers) {
			subscriber.onMessage(event);
		}
	};

	const connection = { source, subscribers };
	sharedConnections.set(url, connection);
	return connection;
}

/**
 * Opens an EventSource to `url` and shares it across subscribers.
 *
 * @returns A cleanup function — call it to unsubscribe and close the shared
 *          connection when no subscribers remain.
 */
export function createSseConnection(options: SseConnectionOptions): () => void {
	const { url, onMessage, onOpen } = options;
	const connection = sharedConnections.get(url) ?? createSharedConnection(url);
	const subscriber: Subscriber = { onMessage, onOpen };
	connection.subscribers.add(subscriber);

	return () => {
		const current = sharedConnections.get(url);
		if (!current) {
			return;
		}

		current.subscribers.delete(subscriber);

		if (current.subscribers.size === 0) {
			current.source.close();
			sharedConnections.delete(url);
		}
	};
}
