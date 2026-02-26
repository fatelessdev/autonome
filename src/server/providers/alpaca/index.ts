/**
 * Alpaca Provider Factory
 *
 * Creates per-model Alpaca trading and market data providers.
 * Each model has its own Alpaca paper account for isolated P&L tracking.
 *
 * Market data provider is shared (same data regardless of account),
 * but trading providers are per-model since each model has unique credentials.
 */

import { ALPACA_PAPER } from "@/env";
import { AlpacaClient, type AlpacaClientConfig } from "./client";
import { AlpacaMarketDataProvider } from "./market-data";
import { AlpacaTradingProvider } from "./trading";

export { AlpacaClient } from "./client";
export { AlpacaMarketDataProvider } from "./market-data";
export { AlpacaTradingProvider } from "./trading";

// Cache trading providers per model to avoid creating duplicate clients
const tradingProviderCache = new Map<string, AlpacaTradingProvider>();

// Shared market data provider (market data doesn't depend on which account)
let sharedMarketDataProvider: AlpacaMarketDataProvider | null = null;
let sharedMarketDataClient: AlpacaClient | null = null;

/**
 * Get or create a trading provider for a specific model's Alpaca credentials.
 * Cached by apiKey to avoid recreating clients for the same model.
 */
export function getTradingProvider(
	alpacaApiKey: string,
	alpacaApiSecret: string,
): AlpacaTradingProvider {
	const cached = tradingProviderCache.get(alpacaApiKey);
	if (cached) return cached;

	const client = new AlpacaClient({
		apiKey: alpacaApiKey,
		apiSecret: alpacaApiSecret,
		paper: ALPACA_PAPER,
	});

	const provider = new AlpacaTradingProvider(client);
	tradingProviderCache.set(alpacaApiKey, provider);
	return provider;
}

/**
 * Get or create the shared market data provider.
 * Uses the first available credentials — market data is the same for any account.
 */
export function getMarketDataProvider(
	alpacaApiKey: string,
	alpacaApiSecret: string,
): AlpacaMarketDataProvider {
	if (sharedMarketDataProvider) return sharedMarketDataProvider;

	sharedMarketDataClient = new AlpacaClient({
		apiKey: alpacaApiKey,
		apiSecret: alpacaApiSecret,
		paper: ALPACA_PAPER,
	});

	sharedMarketDataProvider = new AlpacaMarketDataProvider(
		sharedMarketDataClient,
	);
	return sharedMarketDataProvider;
}

/**
 * Create both providers for a model in one call.
 * Convenience wrapper for use in trading workflows.
 */
export function getProviders(
	alpacaApiKey: string,
	alpacaApiSecret: string,
): {
	trading: AlpacaTradingProvider;
	marketData: AlpacaMarketDataProvider;
} {
	return {
		trading: getTradingProvider(alpacaApiKey, alpacaApiSecret),
		marketData: getMarketDataProvider(alpacaApiKey, alpacaApiSecret),
	};
}

/**
 * Create a standalone AlpacaClient with custom config.
 * Use for one-off operations outside the provider cache.
 */
export function createClient(
	config: Partial<AlpacaClientConfig> & {
		apiKey: string;
		apiSecret: string;
	},
): AlpacaClient {
	return new AlpacaClient({
		paper: ALPACA_PAPER,
		...config,
	});
}

/**
 * Clear all cached providers. Useful for testing or credential rotation.
 */
export function clearProviderCache(): void {
	tradingProviderCache.clear();
	sharedMarketDataProvider = null;
	sharedMarketDataClient = null;
}
