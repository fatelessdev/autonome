import { EventEmitter } from "node:events";

export type PortfolioSnapshotData = {
	modelId: string;
	modelName: string;
	variant?: "Situational" | "Minimal" | "Guardian" | "Max" | "Sovereign";
	netPortfolio: string;
	createdAt: string;
};

export type PortfolioEvent = {
	type: "portfolio:updated";
	timestamp: string;
	// Summary data - just metadata to trigger client refresh
	data: {
		modelsUpdated: number;
		snapshotsCreated: number;
	};
};

const emitter = new EventEmitter();
emitter.setMaxListeners(50);
const EVENT_KEY = "portfolio-update";

// Metadata for cache status
let lastPortfolioUpdateAt: number | null = null;
let lastSnapshotsCreated = 0;

export const emitPortfolioEvent = (event: PortfolioEvent) => {
	lastPortfolioUpdateAt = Date.now();
	lastSnapshotsCreated = event.data.snapshotsCreated;
	emitter.emit(EVENT_KEY, event);
};

export const subscribeToPortfolioEvents = (
	listener: (event: PortfolioEvent) => void,
) => {
	emitter.on(EVENT_KEY, listener);
	return () => {
		emitter.off(EVENT_KEY, listener);
	};
};

export const getPortfolioCacheMetadata = () => {
	return {
		count: lastSnapshotsCreated,
		lastUpdatedAt: lastPortfolioUpdateAt,
	};
};

export const getCurrentPortfolioSummary = () => {
	return {
		snapshotsCreated: lastSnapshotsCreated,
		lastUpdatedAt: lastPortfolioUpdateAt,
	};
};
