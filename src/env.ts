import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { createEnv } from "@t3-oss/env-core";
import { config as loadEnv } from "dotenv";
import { z } from "zod";
import type {
	ExchangeSimulatorOptions,
	TradingMode,
} from "@/server/features/simulator/types";

const cwd = process.cwd();
const envFiles = [".env", ".env.local"];
// const envFiles = [".env", ".env.local", ".env.production", ".env.production.local", ".env.development", ".env.development.local"];

for (const file of envFiles) {
	const fullPath = resolve(cwd, file);
	if (existsSync(fullPath)) {
		loadEnv({ path: fullPath, override: true });
	}
}

const importMetaEnv =
	typeof import.meta !== "undefined" && typeof import.meta.env !== "undefined"
		? import.meta.env
		: {};
const nodeEnv =
	typeof process !== "undefined" && typeof process.env !== "undefined"
		? process.env
		: {};
const runtimeEnv = { ...nodeEnv, ...importMetaEnv };

export const env = createEnv({
	server: {
		// General server configuration
		SERVER_URL: z.string().url().optional(),
		PORT: z.coerce.number().default(8081),
		API_URL: z.string().url().default("http://localhost:8081"),
		CORS_ORIGINS: z.string().optional(),
		// Backend-only variables - optional on Vercel frontend deployment
		DATABASE_URL: z.string().url().optional(),
		NIM_API_KEY: z.string().optional(),
		NIM_API_KEY1: z.string().optional(),
		NIM_API_KEY2: z.string().optional(),
		NIM_API_KEY3: z.string().optional(),
		OPENROUTER_API_KEY: z.string().optional(),
		OPENROUTER_API_KEY1: z.string().optional(),
		AIHUBMIX_API_KEY: z.string().optional(),
		AIHUBMIX_API_KEY1: z.string().optional(),
		AIHUBMIX_API_KEY2: z.string().optional(),
		AIHUBMIX_API_KEY3: z.string().optional(),
		AIHUBMIX_API_KEY4: z.string().optional(),
		AIHUBMIX_API_KEY5: z.string().optional(),
		MISTRAL_API_KEY: z.string().optional(),

		// Lighter API configuration
		LIGHTER_API_KEY_INDEX: z.coerce.number().default(2),
		LIGHTER_BASE_URL: z
			.string()
			.url()
			.default("https://mainnet.zklighter.elliot.ai"),

		// Trading mode
		TRADING_MODE: z.enum(["live", "simulated"]).default("simulated"),

		// Simulator options
		SIM_INITIAL_CAPITAL: z.coerce.number().default(10_000),
		SIM_QUOTE_CURRENCY: z.string().default("USDT"),
		SIM_REFRESH_INTERVAL_MS: z.coerce.number().default(10_000),

		// TAAPI.io integration (optional for supplementary indicators)
		TAAPI_API_KEY: z.string().optional(),
	},

	/**
	 * The prefix that client-side variables must have. This is enforced both at
	 * a type-level and at runtime.
	 */
	clientPrefix: "VITE_",

	client: {
		VITE_APP_TITLE: z.string().min(1).optional(),
		VITE_API_URL: z.string().url().optional(),
	},

	/**
	 * What object holds the environment variables at runtime. This is usually
	 * `process.env` or `import.meta.env`.
	 */
	runtimeEnv,

	/**
	 * By default, this library will feed the environment variables directly to
	 * the Zod validator.
	 *
	 * This means that if you have an empty string for a value that is supposed
	 * to be a number (e.g. `PORT=` in a ".env" file), Zod will incorrectly flag
	 * it as a type mismatch violation. Additionally, if you have an empty string
	 * for a value that is supposed to be a string with a default value (e.g.
	 * `DOMAIN=` in an ".env" file), the default value will never be applied.
	 *
	 * In order to solve these issues, we recommend that all new projects
	 * explicitly specify this option as true.
	 */
	emptyStringAsUndefined: true,
});

// Export convenient aliases for backwards compatibility and cleaner imports
export const API_URL = env.API_URL;
export const API_KEY_INDEX = env.LIGHTER_API_KEY_INDEX;
export const BASE_URL = env.LIGHTER_BASE_URL;
export const TRADING_MODE: TradingMode = env.TRADING_MODE;
export const IS_SIMULATION_ENABLED = env.TRADING_MODE === "simulated";

export const DEFAULT_SIMULATOR_OPTIONS: ExchangeSimulatorOptions = {
	initialCapital: env.SIM_INITIAL_CAPITAL,
	quoteCurrency: env.SIM_QUOTE_CURRENCY,
	refreshIntervalMs: env.SIM_REFRESH_INTERVAL_MS,
};

// TAAPI API key for supplementary indicators (optional)
export const TAAPI_API_KEY = env.TAAPI_API_KEY;

type ApiKeyRotator = {
	getNext: () => string;
	getCount: () => number;
};

function createApiKeyRotator(name: string, keys: Array<string | undefined>): ApiKeyRotator {
	const availableKeys = keys.filter((key): key is string => Boolean(key));
	let requestCounter = 0;

	return {
		getNext: () => {
			if (availableKeys.length === 0) {
				throw new Error(`No ${name} API keys configured`);
			}
			const key = availableKeys[requestCounter % availableKeys.length]!;
			requestCounter++;
			return key;
		},
		getCount: () => availableKeys.length,
	};
}

// ==================== API Key Cycling ====================
const nimKeyRotator = createApiKeyRotator("NIM", [
	env.NIM_API_KEY,
	env.NIM_API_KEY1,
	env.NIM_API_KEY2,
	env.NIM_API_KEY3,
]);

const openRouterKeyRotator = createApiKeyRotator("OpenRouter", [
	env.OPENROUTER_API_KEY,
	env.OPENROUTER_API_KEY1,
]);

const aihubmixKeyRotator = createApiKeyRotator("AIHubMix", [
	env.AIHUBMIX_API_KEY,
	env.AIHUBMIX_API_KEY1,
	env.AIHUBMIX_API_KEY2,
]);

/**
 * Get the next NIM API key using round-robin cycling.
 * This distributes requests across multiple keys to avoid rate limits.
 */
export function getNextNimApiKey(): string {
	return nimKeyRotator.getNext();
}

/**
 * Get all available NIM API keys count (for logging/debugging)
 */
export function getNimApiKeyCount(): number {
	return nimKeyRotator.getCount();
}

/**
 * Get the next OpenRouter API key using round-robin cycling.
 * This distributes requests across multiple keys to avoid rate limits.
 */
export function getNextOpenRouterApiKey(): string {
	return openRouterKeyRotator.getNext();
}

/**
 * Get all available OpenRouter API keys count (for logging/debugging)
 */
export function getOpenRouterApiKeyCount(): number {
	return openRouterKeyRotator.getCount();
}

/**
 * Get the next AIHubMix API key using round-robin cycling.
 * This distributes requests across multiple keys to avoid rate limits.
 */
export function getNextAihubmixApiKey(): string {
	return aihubmixKeyRotator.getNext();
}

/**
 * Get all available AIHubMix API keys count (for logging/debugging)
 */
export function getAihubmixApiKeyCount(): number {
	return aihubmixKeyRotator.getCount();
}
