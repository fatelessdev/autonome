#!/usr/bin/env bun

import "dotenv/config";

// Minimal console helper
const formatStatus = (label: string, value: string) => `${label.padEnd(24, " ")} ${value}`;

type EnvCheck = {
	key: string;
	description: string;
	optional?: boolean;
};

const checks: EnvCheck[] = [
	{ key: "DATABASE_URL", description: "PostgreSQL connection" },
	{ key: "SERVER_URL", description: "Public server origin", optional: true },
	{ key: "TRADING_MODE", description: "Trading mode flag" },
	{ key: "IS_SIMULATION_ENABLED", description: "Client simulation flag" },
	{ key: "LIGHTER_API_KEY_INDEX", description: "Lighter API key slot" },
	{ key: "LIGHTER_BASE_URL", description: "Lighter REST base" },
	{ key: "ANTHROPIC_API_KEY", description: "Anthropic provider key" },
	{ key: "GOOGLE_API_KEY", description: "Google provider key", optional: true },
	{ key: "OPENAI_API_KEY", description: "OpenAI provider key", optional: true },
	{ key: "MISTRAL_API_KEY", description: "Mistral provider key", optional: true },
	{ key: "NIM_API_KEY", description: "NVIDIA NIM key", optional: true },
	{ key: "VITE_SENTRY_DSN", description: "Browser Sentry DSN" },
];

const missing: EnvCheck[] = [];
const optionalMissing: EnvCheck[] = [];

console.log("\nAutonome3 environment validation\n--------------------------------");

for (const check of checks) {
	const value = process.env[check.key];
	if (!value) {
		(check.optional ? optionalMissing : missing).push(check);
		console.log(formatStatus(check.key, "MISSING"));
	} else {
		console.log(formatStatus(check.key, "OK"));
	}
}

const tradingMode = (process.env.TRADING_MODE || "").toLowerCase();
const simulationFlag = (process.env.IS_SIMULATION_ENABLED || "").toLowerCase();
const simulationMismatch =
	tradingMode === "simulated" && simulationFlag !== "true";
const liveMismatch = tradingMode === "live" && simulationFlag === "true";

if (simulationMismatch) {
	console.warn(
		"\n[warn] TRADING_MODE=simulated but IS_SIMULATION_ENABLED is not true",
	);
}
if (liveMismatch) {
	console.warn(
		"\n[warn] TRADING_MODE=live but IS_SIMULATION_ENABLED is still true",
	);
}

if (missing.length === 0 && simulationMismatch === false && liveMismatch === false) {
	console.log("\nEnvironment looks good ✅\n");
	process.exit(0);
}

console.error("\nEnvironment validation failed");
if (missing.length > 0) {
	for (const check of missing) {
		console.error(` - ${check.key}: ${check.description}`);
	}
}
if (optionalMissing.length > 0) {
	console.error("\nOptional providers missing (features will degrade):");
	for (const check of optionalMissing) {
		console.error(` - ${check.key}: ${check.description}`);
	}
}

process.exit(1);
