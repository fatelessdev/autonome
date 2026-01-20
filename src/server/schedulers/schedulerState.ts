/**
 * Consolidated Scheduler State Module
 *
 * Single HMR-safe state container for all scheduler-related globals.
 * Uses a single globalThis.__schedulerState object instead of scattered globals.
 *
 * Benefits:
 * - Single source of truth for scheduler state
 * - Type-safe getters/setters
 * - Survives HMR in development
 * - Cleaner health endpoint implementation
 */

// ==================== State Types ====================

export interface TradeSchedulerState {
	/** Interval handle for the trade scheduler */
	intervalHandle: ReturnType<typeof setInterval> | undefined;
	/** Timestamp of last scheduler run */
	lastRun: number | undefined;
	/** Timestamp of last successful model completion */
	lastSuccessfulCompletion: number | undefined;
	/** Stats from last cycle */
	lastCycleStats: {
		successCount: number;
		failureCount: number;
		totalModels: number;
		timestamp: number;
	} | undefined;
	/** Count of consecutive cycles where all models failed */
	consecutiveFailedCycles: number;
	/** Map of model IDs to running state */
	modelsRunning: Map<string, boolean>;
	/** Map of model IDs to start timestamps */
	modelsRunningStartTime: Map<string, number>;
}

export interface PortfolioSchedulerState {
	/** Whether the scheduler has been initialized */
	initialized: boolean;
	/** Interval handle for portfolio snapshots */
	intervalHandle: ReturnType<typeof setInterval> | undefined;
	/** Interval handle for retention policy */
	retentionIntervalHandle: ReturnType<typeof setInterval> | undefined;
	/** Timestamp of last scheduler run */
	lastRun: number | undefined;
}

export interface SchedulerState {
	/** Whether schedulers have been bootstrapped */
	bootstrapped: boolean;
	/** Server start time for uptime calculation */
	serverStartTime: number;
	/** Trade scheduler state */
	trade: TradeSchedulerState;
	/** Portfolio scheduler state */
	portfolio: PortfolioSchedulerState;
}

// ==================== Global Declaration ====================

declare global {
	// eslint-disable-next-line no-var
	var __schedulerState: SchedulerState | undefined;
}

// ==================== Default State ====================

function createDefaultState(): SchedulerState {
	return {
		bootstrapped: false,
		serverStartTime: Date.now(),
		trade: {
			intervalHandle: undefined,
			lastRun: undefined,
			lastSuccessfulCompletion: undefined,
			lastCycleStats: undefined,
			consecutiveFailedCycles: 0,
			modelsRunning: new Map(),
			modelsRunningStartTime: new Map(),
		},
		portfolio: {
			initialized: false,
			intervalHandle: undefined,
			retentionIntervalHandle: undefined,
			lastRun: undefined,
		},
	};
}

// ==================== State Accessor ====================

/**
 * Get the scheduler state, initializing if needed.
 * This is the main access point for all scheduler state.
 */
export function getSchedulerState(): SchedulerState {
	if (!globalThis.__schedulerState) {
		globalThis.__schedulerState = createDefaultState();
	}
	return globalThis.__schedulerState;
}

// ==================== Bootstrap State ====================

export function isBootstrapped(): boolean {
	return getSchedulerState().bootstrapped;
}

export function markBootstrapped(): void {
	getSchedulerState().bootstrapped = true;
}

export function getServerStartTime(): number {
	return getSchedulerState().serverStartTime;
}

// ==================== Trade Scheduler State ====================

export function getTradeState(): TradeSchedulerState {
	return getSchedulerState().trade;
}

export function setTradeIntervalHandle(handle: ReturnType<typeof setInterval> | undefined): void {
	getTradeState().intervalHandle = handle;
}

export function getTradeIntervalHandle(): ReturnType<typeof setInterval> | undefined {
	return getTradeState().intervalHandle;
}

export function setTradeLastRun(timestamp: number): void {
	getTradeState().lastRun = timestamp;
}

export function getTradeLastRun(): number | undefined {
	return getTradeState().lastRun;
}

export function setTradeLastSuccessfulCompletion(timestamp: number): void {
	getTradeState().lastSuccessfulCompletion = timestamp;
}

export function getTradeLastSuccessfulCompletion(): number | undefined {
	return getTradeState().lastSuccessfulCompletion;
}

export function setTradeLastCycleStats(stats: TradeSchedulerState["lastCycleStats"]): void {
	getTradeState().lastCycleStats = stats;
}

export function getTradeLastCycleStats(): TradeSchedulerState["lastCycleStats"] {
	return getTradeState().lastCycleStats;
}

export function incrementConsecutiveFailedCycles(): void {
	getTradeState().consecutiveFailedCycles++;
}

export function resetConsecutiveFailedCycles(): void {
	getTradeState().consecutiveFailedCycles = 0;
}

export function getConsecutiveFailedCycles(): number {
	return getTradeState().consecutiveFailedCycles;
}

export function isModelRunning(modelId: string): boolean {
	return getTradeState().modelsRunning.get(modelId) ?? false;
}

export function setModelRunning(modelId: string, running: boolean): void {
	const state = getTradeState();
	state.modelsRunning.set(modelId, running);
	if (running) {
		state.modelsRunningStartTime.set(modelId, Date.now());
	} else {
		state.modelsRunningStartTime.delete(modelId);
	}
}

export function getModelRunningStartTime(modelId: string): number | undefined {
	return getTradeState().modelsRunningStartTime.get(modelId);
}

export function getRunningModels(): Array<{ id: string; startTime: number }> {
	const state = getTradeState();
	return Array.from(state.modelsRunning.entries())
		.filter(([_, running]) => running)
		.map(([id]) => ({
			id,
			startTime: state.modelsRunningStartTime.get(id) ?? Date.now(),
		}));
}

export function clearStaleRunningModels(thresholdMs: number): void {
	const now = Date.now();
	const state = getTradeState();
	
	for (const [modelId, startTime] of state.modelsRunningStartTime.entries()) {
		if (now - startTime > thresholdMs) {
			console.warn(
				`[Scheduler State] Clearing stale running state for model ${modelId} (stuck for ${Math.round((now - startTime) / 1000)}s)`,
			);
			state.modelsRunning.set(modelId, false);
			state.modelsRunningStartTime.delete(modelId);
		}
	}
}

// ==================== Portfolio Scheduler State ====================

export function getPortfolioState(): PortfolioSchedulerState {
	return getSchedulerState().portfolio;
}

export function isPortfolioInitialized(): boolean {
	return getPortfolioState().initialized;
}

export function markPortfolioInitialized(): void {
	getPortfolioState().initialized = true;
}

export function setPortfolioIntervalHandle(handle: ReturnType<typeof setInterval> | undefined): void {
	getPortfolioState().intervalHandle = handle;
}

export function getPortfolioIntervalHandle(): ReturnType<typeof setInterval> | undefined {
	return getPortfolioState().intervalHandle;
}

export function setRetentionIntervalHandle(handle: ReturnType<typeof setInterval> | undefined): void {
	getPortfolioState().retentionIntervalHandle = handle;
}

export function setPortfolioLastRun(timestamp: number): void {
	getPortfolioState().lastRun = timestamp;
}

export function getPortfolioLastRun(): number | undefined {
	return getPortfolioState().lastRun;
}

// ==================== Health Check Helpers ====================

export interface SchedulerHealthStatus {
	status: "ok" | "degraded";
	timestamp: string;
	serverStartedAt: string;
	uptimeSeconds: number;
	schedulers: {
		trade: {
			healthy: boolean;
			lastRun: string | null;
			ageMs: number | null;
		};
		portfolio: {
			healthy: boolean;
			lastRun: string | null;
			ageMs: number | null;
		};
	};
}

export interface SchedulerDetailedHealth {
	timestamp: string;
	serverStartedAt: string;
	uptimeSeconds: number;
	tradeScheduler: {
		lastRun: string | null;
		ageSeconds: number | null;
		modelsCurrentlyRunning: Array<{ id: string; runningForSeconds: number | null }>;
		intervalHandle: boolean;
		lastSuccessfulCompletion: string | null;
		lastSuccessAge: number | null;
		lastCycleStats: {
			successCount: number;
			failureCount: number;
			totalModels: number;
			timestamp: string;
		} | null;
		consecutiveFailedCycles: number;
	};
	portfolioScheduler: {
		lastRun: string | null;
		ageSeconds: number | null;
		intervalHandle: boolean;
		initialized: boolean;
	};
}

/**
 * Get scheduler health status for the /health endpoint
 */
export function getSchedulerHealth(): SchedulerHealthStatus {
	const now = Date.now();
	const state = getSchedulerState();
	const tradeState = state.trade;
	const portfolioState = state.portfolio;

	const TRADE_INTERVAL_MS = 5 * 60 * 1000;
	const PORTFOLIO_INTERVAL_MS = 1 * 60 * 1000;
	const MAX_SUCCESS_AGE_MS = 15 * 60 * 1000;

	// Trade scheduler running check
	const tradeSchedulerRunning = tradeState.lastRun
		? now - tradeState.lastRun < TRADE_INTERVAL_MS * 2
		: false;

	// Trade scheduler healthy check
	const isNewServer = !tradeState.lastCycleStats && now - state.serverStartTime < TRADE_INTERVAL_MS * 2;
	const hasRecentSuccess = tradeState.lastSuccessfulCompletion
		? now - tradeState.lastSuccessfulCompletion < MAX_SUCCESS_AGE_MS
		: isNewServer;
	const tradeSchedulerHealthy = tradeSchedulerRunning && hasRecentSuccess && tradeState.consecutiveFailedCycles < 3;

	// Portfolio scheduler healthy check
	const portfolioSchedulerHealthy = portfolioState.lastRun
		? now - portfolioState.lastRun < PORTFOLIO_INTERVAL_MS * 2
		: false;

	const allHealthy = tradeSchedulerHealthy && portfolioSchedulerHealthy;
	const uptimeSeconds = Math.floor((now - state.serverStartTime) / 1000);

	return {
		status: allHealthy ? "ok" : "degraded",
		timestamp: new Date().toISOString(),
		serverStartedAt: new Date(state.serverStartTime).toISOString(),
		uptimeSeconds,
		schedulers: {
			trade: {
				healthy: tradeSchedulerHealthy,
				lastRun: tradeState.lastRun ? new Date(tradeState.lastRun).toISOString() : null,
				ageMs: tradeState.lastRun ? now - tradeState.lastRun : null,
			},
			portfolio: {
				healthy: portfolioSchedulerHealthy,
				lastRun: portfolioState.lastRun ? new Date(portfolioState.lastRun).toISOString() : null,
				ageMs: portfolioState.lastRun ? now - portfolioState.lastRun : null,
			},
		},
	};
}

/**
 * Get detailed scheduler health for the /health/schedulers endpoint
 */
export function getSchedulerDetailedHealth(): SchedulerDetailedHealth {
	const now = Date.now();
	const state = getSchedulerState();
	const tradeState = state.trade;
	const portfolioState = state.portfolio;
	const uptimeSeconds = Math.floor((now - state.serverStartTime) / 1000);

	const runningModelsInfo = getRunningModels().map(({ id, startTime }) => ({
		id,
		runningForSeconds: Math.round((now - startTime) / 1000),
	}));

	return {
		timestamp: new Date().toISOString(),
		serverStartedAt: new Date(state.serverStartTime).toISOString(),
		uptimeSeconds,
		tradeScheduler: {
			lastRun: tradeState.lastRun ? new Date(tradeState.lastRun).toISOString() : null,
			ageSeconds: tradeState.lastRun ? Math.round((now - tradeState.lastRun) / 1000) : null,
			modelsCurrentlyRunning: runningModelsInfo,
			intervalHandle: Boolean(tradeState.intervalHandle),
			lastSuccessfulCompletion: tradeState.lastSuccessfulCompletion
				? new Date(tradeState.lastSuccessfulCompletion).toISOString()
				: null,
			lastSuccessAge: tradeState.lastSuccessfulCompletion
				? Math.round((now - tradeState.lastSuccessfulCompletion) / 1000)
				: null,
			lastCycleStats: tradeState.lastCycleStats
				? {
						successCount: tradeState.lastCycleStats.successCount,
						failureCount: tradeState.lastCycleStats.failureCount,
						totalModels: tradeState.lastCycleStats.totalModels,
						timestamp: new Date(tradeState.lastCycleStats.timestamp).toISOString(),
					}
				: null,
			consecutiveFailedCycles: tradeState.consecutiveFailedCycles,
		},
		portfolioScheduler: {
			lastRun: portfolioState.lastRun ? new Date(portfolioState.lastRun).toISOString() : null,
			ageSeconds: portfolioState.lastRun ? Math.round((now - portfolioState.lastRun) / 1000) : null,
			intervalHandle: Boolean(portfolioState.intervalHandle),
			initialized: portfolioState.initialized,
		},
	};
}
