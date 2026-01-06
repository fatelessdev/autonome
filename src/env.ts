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
		FRONTEND_PORT: z.coerce.number().default(5173),
		API_URL: z.string().url().default("http://localhost:8081"),
		CORS_ORIGINS: z.string().optional(),
		DATABASE_URL: z.string().url(),
		NIM_API_KEY: z.string(),
		OPENROUTER_API_KEY: z.string(),
		MISTRAL_API_KEY: z.string(),

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
export const FRONTEND_PORT = env.FRONTEND_PORT;
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
