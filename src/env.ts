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
const mode = process.env.NODE_ENV ?? "development";
const envFiles = [".env", ".env.local", `.env.${mode}`, `.env.${mode}.local`];

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

		// Lighter API configuration
		LIGHTER_API_KEY_INDEX: z.coerce.number().default(2),
		LIGHTER_BASE_URL: z
			.string()
			.url()
			.default("https://mainnet.zklighter.elliot.ai"),

		// Trading mode
		TRADING_MODE: z.enum(["live", "simulated"]).default("live"),

		// Simulator options
		SIM_INITIAL_CAPITAL: z.coerce.number().default(10_000),
		SIM_QUOTE_CURRENCY: z.string().default("USDT"),
		SIM_MIN_LATENCY_MS: z.coerce.number().default(40),
		SIM_MAX_LATENCY_MS: z.coerce.number().default(250),
		SIM_MAX_SLIPPAGE_BPS: z.coerce.number().default(10),
		SIM_MAKER_FEE_BPS: z.coerce.number().default(2),
		SIM_TAKER_FEE_BPS: z.coerce.number().default(5),
		SIM_DETERMINISTIC_SEED: z.coerce.number().optional(),
		SIM_FUNDING_PERIOD_HOURS: z.coerce.number().default(8),
		SIM_FUNDING_REFRESH_MS: z.coerce.number().default(60_000),
		SIM_REFRESH_INTERVAL_MS: z.coerce.number().default(3_000),
	},

	/**
	 * The prefix that client-side variables must have. This is enforced both at
	 * a type-level and at runtime.
	 */
	clientPrefix: "VITE_",

	client: {
		VITE_APP_TITLE: z.string().min(1).optional(),
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
export const API_KEY_INDEX = env.LIGHTER_API_KEY_INDEX;
export const BASE_URL = env.LIGHTER_BASE_URL;
export const TRADING_MODE: TradingMode = env.TRADING_MODE;
export const IS_SIMULATION_ENABLED = env.TRADING_MODE === "simulated";

export const DEFAULT_SIMULATOR_OPTIONS: ExchangeSimulatorOptions = {
	initialCapital: env.SIM_INITIAL_CAPITAL,
	quoteCurrency: env.SIM_QUOTE_CURRENCY,
	latency: {
		minMs: env.SIM_MIN_LATENCY_MS,
		maxMs: env.SIM_MAX_LATENCY_MS,
	},
	slippage: {
		maxBasisPoints: env.SIM_MAX_SLIPPAGE_BPS,
	},
	fees: {
		makerBps: env.SIM_MAKER_FEE_BPS,
		takerBps: env.SIM_TAKER_FEE_BPS,
	},
	deterministicSeed: env.SIM_DETERMINISTIC_SEED,
	fundingPeriodHours: env.SIM_FUNDING_PERIOD_HOURS,
	fundingRefreshIntervalMs: env.SIM_FUNDING_REFRESH_MS,
	refreshIntervalMs: env.SIM_REFRESH_INTERVAL_MS,
};
