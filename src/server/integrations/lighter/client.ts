/**
 * Centralized Lighter API client instances.
 *
 * All server-side code should import from this module to avoid creating
 * duplicate API client instances which would cause unnecessary API calls
 * and potential rate limiting.
 *
 * Migrated from lighter-sdk-ts to @reservoir0x/lighter-ts-sdk
 */
import { BASE_URL } from "@/env";
import {
	ApiClient,
	CandlestickApi,
	FundingApi,
	OrderApi,
	AccountApi,
} from "@reservoir0x/lighter-ts-sdk";

// Singleton API client
const apiClient = new ApiClient({ host: BASE_URL });

// Singleton API instances - all server code should use these
export const candlestickApi = new CandlestickApi(apiClient);
export const fundingApi = new FundingApi(apiClient);
export const orderApi = new OrderApi(apiClient);
export const accountApi = new AccountApi(apiClient);

// Re-export types and utilities that may be needed
export { apiClient, BASE_URL };
