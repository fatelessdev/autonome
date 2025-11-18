import { EventEmitter } from "node:events";

export type PositionEventData = {
	modelId: string;
	modelName: string;
	modelLogo: string;
	positions: unknown[];
	totalUnrealizedPnl: number;
	availableCash: number;
};

export type PositionEvent = {
	type: "positions:updated";
	timestamp: string;
	data: PositionEventData[];
};

const emitter = new EventEmitter();
emitter.setMaxListeners(50);
const EVENT_KEY = "position-update";

// Cache for current positions
let currentPositionsCache: PositionEventData[] = [];
let lastPositionUpdateAt: number | null = null;

export const emitPositionEvent = (event: PositionEvent) => {
	currentPositionsCache = event.data;
	lastPositionUpdateAt = Date.now();
	emitter.emit(EVENT_KEY, event);
};

export const subscribeToPositionEvents = (
	listener: (event: PositionEvent) => void,
) => {
	emitter.on(EVENT_KEY, listener);
	return () => {
		emitter.off(EVENT_KEY, listener);
	};
};

export const getCurrentPositions = () => {
	return currentPositionsCache;
};

export const getPositionCacheMetadata = () => {
	return {
		count: currentPositionsCache.length,
		lastUpdatedAt: lastPositionUpdateAt,
	};
};
