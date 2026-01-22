import { DEFAULT_SIMULATOR_OPTIONS, IS_SIMULATION_ENABLED } from "@/env";
import { ensurePortfolioScheduler } from "@/server/features/portfolio/priceTracker";
import { ExchangeSimulator } from "@/server/features/simulator/exchangeSimulator";
import { ensureTradeScheduler } from "@/server/features/trading/tradeExecutor";
import { isBootstrapped, markBootstrapped } from "@/server/schedulers/schedulerState";

export async function bootstrapSchedulers() {
	const isBrowser = typeof window !== "undefined" && typeof window.document !== "undefined";
	if (isBrowser || isBootstrapped()) {
		return;
	}

	markBootstrapped();
	console.log("🚀 Server-side bootstrap: initializing schedulers...");
	if (IS_SIMULATION_ENABLED) {
		await ExchangeSimulator.bootstrap(DEFAULT_SIMULATOR_OPTIONS);
	}
	ensurePortfolioScheduler();
	ensureTradeScheduler();
	console.log("✅ Schedulers initialized");
}
