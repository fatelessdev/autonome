import { DEFAULT_SIMULATOR_OPTIONS, IS_SIMULATION_ENABLED } from "../env";

declare global {
	var __autonomeSchedulersBootstrapped: boolean | undefined;
}

export async function bootstrapSchedulers() {
	if (globalThis.__autonomeSchedulersBootstrapped) {
		return;
	}

	globalThis.__autonomeSchedulersBootstrapped = true;
	console.log("🚀 Bootstrapping schedulers...");
	
	try {
		// Dynamically import to avoid failing if DB isn't available
		const { ensurePortfolioScheduler } = await import("../features/portfolio/priceTracker");
		const { ensureTradeScheduler } = await import("../features/trading/tradeExecutor");
		
		if (IS_SIMULATION_ENABLED) {
			const { ExchangeSimulator } = await import("../features/simulator/exchangeSimulator");
			await ExchangeSimulator.bootstrap(DEFAULT_SIMULATOR_OPTIONS);
		}
		
		ensurePortfolioScheduler();
		ensureTradeScheduler();
		
		console.log("✅ Schedulers initialized");
	} catch (error) {
		console.error("⚠️ Failed to initialize schedulers (database may be unavailable):", error instanceof Error ? error.message : error);
		console.log("   Server will continue without schedulers - API endpoints may have limited functionality");
	}
}



