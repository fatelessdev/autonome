export type DashboardSseEventType =
	| "trades:changed"
	| "positions:changed"
	| "conversations:changed"
	| "portfolio:changed"
	| "connected";

export type DashboardSseEvent = {
	type: DashboardSseEventType;
	timestamp: string;
};
