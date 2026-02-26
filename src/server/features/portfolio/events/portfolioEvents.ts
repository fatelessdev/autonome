import type { VariantId } from "@/core/shared/variants";
import { createTypedEventBus } from "@/server/events/typedEventBus";

export type PortfolioSnapshotData = {
	modelId: string;
	modelName: string;
	variant?: VariantId;
	netPortfolio: string;
	createdAt: string;
};

export type PortfolioEvent = {
	type: "portfolio:updated";
	timestamp: string;
	// Summary metadata to trigger client refresh, not full data
	data: {
		modelsUpdated: number;
		snapshotsCreated: number;
	};
};

const bus = createTypedEventBus<PortfolioEvent>("portfolio-update");

let lastPortfolioUpdateAt: number | null = null;
let lastSnapshotsCreated = 0;

export const emitPortfolioEvent = (event: PortfolioEvent): void => {
	lastPortfolioUpdateAt = Date.now();
	lastSnapshotsCreated = event.data.snapshotsCreated;
	bus.emit(event);
};

export const subscribeToPortfolioEvents = bus.subscribe;

export const getPortfolioCacheMetadata = () => ({
	count: lastSnapshotsCreated,
	lastUpdatedAt: lastPortfolioUpdateAt,
});

export const getCurrentPortfolioSummary = () => ({
	snapshotsCreated: lastSnapshotsCreated,
	lastUpdatedAt: lastPortfolioUpdateAt,
});
