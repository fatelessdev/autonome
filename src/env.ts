import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { createEnv } from "@t3-oss/env-core";
import { config as loadEnv } from "dotenv";
import { z } from "zod";

const cwd = process.cwd();
const envFiles = [".env", ".env.local"];

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
		API_PORT: z.coerce.number().default(8081),
		FRONTEND_PORT: z.coerce.number().default(5173),
		API_URL: z.string().url().default("http://localhost:8081"),
		CORS_ORIGINS: z.string().optional(),
		VERCEL: z.string().optional(),
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

		// Alpaca API configuration
		// Each model gets its own Alpaca paper account for isolated P&L tracking
		ALPACA_PAPER: z
			.enum(["true", "false"])
			.default("true")
			.transform((v) => v === "true"),

		// TAAPI.io integration (optional for supplementary indicators)
		TAAPI_API_KEY: z.string().optional(),
		TAAPI_API_KEY1: z.string().optional(),
		TAAPI_API_KEY2: z.string().optional(),
		TAAPI_API_KEY3: z.string().optional(),
		FALLBACK_MODEL: z.string().optional(),
	},

	clientPrefix: "VITE_",

	client: {
		VITE_APP_TITLE: z.string().min(1).optional(),
		VITE_API_URL: z.string().url().optional(),
	},

	runtimeEnv,
	emptyStringAsUndefined: true,
});

// Export convenient aliases
export const API_URL = env.API_URL;
export const ALPACA_PAPER = env.ALPACA_PAPER;

// TAAPI API key for supplementary indicators (optional)
export const TAAPI_API_KEY = env.TAAPI_API_KEY;
// Optional reasoning-model fallback when a competition has only one model.
export const fallbackModel = env.FALLBACK_MODEL;

type ApiKeyRotator = {
	getNext: () => string;
	getCount: () => number;
};

function createApiKeyRotator(
	name: string,
	keys: Array<string | undefined>,
): ApiKeyRotator {
	const availableKeys = keys.filter((key): key is string => Boolean(key));
	let requestCounter = 0;

	return {
		getNext: () => {
			if (availableKeys.length === 0) {
				throw new Error(`No ${name} API keys configured`);
			}
			const key = availableKeys[requestCounter % availableKeys.length];
			if (!key) {
				throw new Error(`No ${name} API keys configured`);
			}
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

const taapiKeyRotator = createApiKeyRotator("TAAPI", [
	env.TAAPI_API_KEY,
	env.TAAPI_API_KEY1,
	env.TAAPI_API_KEY2,
	env.TAAPI_API_KEY3,
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

/**
 * Get the next TAAPI API key using round-robin cycling.
 * This distributes requests across multiple keys to avoid rate limits.
 * On free plan (1 req/15s), 3 keys = 1 request/5s effective rate.
 */
export function getNextTaapiKey(): string {
	return taapiKeyRotator.getNext();
}

/**
 * Get all available TAAPI API keys count (for logging/debugging)
 */
export function getTaapiKeyCount(): number {
	return taapiKeyRotator.getCount();
}
