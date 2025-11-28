/**
 * Centralized Lighter API client instances.
 *
 * All server-side code should import from this module to avoid creating
 * duplicate API client instances which would cause unnecessary API calls
 * and potential rate limiting.
 */
import { BASE_URL } from "@/env";
import {
	CandlestickApi,
	FundingApi,
	IsomorphicFetchHttpLibrary,
	OrderApi,
	ServerConfiguration,
} from "@/lighter/generated/index";

// Shared configuration
const serverConfiguration = new ServerConfiguration(BASE_URL, {});
const httpLibrary = new IsomorphicFetchHttpLibrary();

// Singleton API instances - all server code should use these
export const candlestickApi = new CandlestickApi({
	baseServer: serverConfiguration,
	httpApi: httpLibrary,
	middleware: [],
	authMethods: {},
});

export const fundingApi = new FundingApi({
	baseServer: serverConfiguration,
	httpApi: httpLibrary,
	middleware: [],
	authMethods: {},
});

export const orderApi = new OrderApi({
	baseServer: serverConfiguration,
	httpApi: httpLibrary,
	middleware: [],
	authMethods: {},
});

// Re-export types and utilities that may be needed
export { BASE_URL, serverConfiguration, httpLibrary };
