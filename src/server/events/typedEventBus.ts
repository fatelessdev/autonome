import { EventEmitter } from "node:events";

/**
 * Creates a typed event bus backed by a single EventEmitter.
 * Eliminates the emit / subscribe / cleanup boilerplate repeated across every
 * event module (positionEvents, tradeEvents, conversationEvents, portfolioEvents).
 */
export function createTypedEventBus<TEvent>(key: string, maxListeners = 50) {
	const emitter = new EventEmitter();
	emitter.setMaxListeners(maxListeners);

	return {
		emit(event: TEvent): void {
			emitter.emit(key, event);
		},
		subscribe(listener: (event: TEvent) => void): () => void {
			emitter.on(key, listener);
			return () => emitter.off(key, listener);
		},
	};
}

export type TypedEventBus<TEvent> = ReturnType<
	typeof createTypedEventBus<TEvent>
>;
