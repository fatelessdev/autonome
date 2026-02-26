import { createTypedEventBus } from "@/server/events/typedEventBus";

export type PositionEventData = {
	modelId: string;
	modelName: string;
	modelLogo: string;
	positions: unknown[];
	totalUnrealizedPnl: number;
};

export type PositionEvent = {
	type: "positions:updated";
	timestamp: string;
	data: PositionEventData[];
};

const bus = createTypedEventBus<PositionEvent>("position-update");

let currentPositionsCache: PositionEventData[] = [];
let lastPositionUpdateAt: number | null = null;

export const emitPositionEvent = (event: PositionEvent): void => {
	currentPositionsCache = event.data;
	lastPositionUpdateAt = Date.now();
	bus.emit(event);
};

export const subscribeToPositionEvents = bus.subscribe;

export const getCurrentPositions = (): PositionEventData[] =>
	currentPositionsCache;

export const getPositionCacheMetadata = () => ({
	count: currentPositionsCache.length,
	lastUpdatedAt: lastPositionUpdateAt,
});
