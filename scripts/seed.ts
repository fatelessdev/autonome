/**
 * Seed Script - Resets and seeds the database with initial model data
 *
 * Usage: bun run scripts/seed.ts
 *
 * This script will:
 * 1. Truncate all tables (cascade)
 * 2. Insert the predefined AI model accounts into the Models table
 */

import { config } from "dotenv";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { Pool } from "pg";
import { env } from "@/env";
import type { VariantId } from "@/core/shared/variants";

// Load environment variables
config({ path: ".env.local" });
config({ path: ".env" });
config({ path: ".env.development" });

const DATABASE_URL = process.env.DATABASE_URL || env.DATABASE_URL;

if (!DATABASE_URL) {
	console.error("❌ DATABASE_URL is not set in environment variables");
	process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL });
const db = drizzle(pool);

type ModelDefinition = {
	openRouterModelName: string;
	variant: VariantId;
	alpacaKeyEnv: string;
	alpacaSecretEnv: string;
};

// Active model definitions — one Alpaca paper account per model.
const MODEL_DEFINITIONS: ModelDefinition[] = [
	{
		openRouterModelName: "minimaxai/minimax-m2.7",
		variant: "Contrarian",
		alpacaKeyEnv: "ALPACA_MINIMAX_API_KEY",
		alpacaSecretEnv: "ALPACA_MINIMAX_API_SECRET",
	},
	{
		openRouterModelName: "stepfun-ai/step-3.7-flash",
		variant: "Trendsurfer",
		alpacaKeyEnv: "ALPACA_STEP_API_KEY",
		alpacaSecretEnv: "ALPACA_STEP_API_SECRET",
	},
	{
		openRouterModelName: "nvidia/nemotron-3-ultra-550b-a55b",
		variant: "Sovereign",
		alpacaKeyEnv: "ALPACA_NEMOTRON_API_KEY",
		alpacaSecretEnv: "ALPACA_NEMOTRON_API_SECRET",
	},
];

/**
 * Extract display name from openRouterModelName
 * e.g., "x-ai/grok-4.1-fast:free" -> "grok-4.1-fast"
 */
function extractModelName(openRouterModelName: string): string {
	// Get the part after the org (after /)
	const afterSlash = openRouterModelName.split("/")[1] ?? openRouterModelName;
	// Remove :free suffix if present
	return afterSlash.replace(/:free$/, "");
}

function requireEnvVar(name: string): string {
	const value = process.env[name];
	if (!value) {
		throw new Error(`Missing required seed environment variable: ${name}`);
	}
	return value;
}

export async function seed() {
	console.log("🌱 Starting database seed...\n");

	try {
		// Step 1: Truncate all tables with CASCADE
		console.log("🗑️  Truncating all tables...");

		// Order matters due to foreign key constraints, but CASCADE handles it
		// Using raw SQL for TRUNCATE with CASCADE
		await db.execute(sql`TRUNCATE TABLE "ToolCalls" CASCADE`);
		await db.execute(sql`TRUNCATE TABLE "Invocations" CASCADE`);
		await db.execute(sql`TRUNCATE TABLE "PortfolioSize" CASCADE`);
		await db.execute(sql`TRUNCATE TABLE "Orders" CASCADE`);
		await db.execute(sql`TRUNCATE TABLE "Models" CASCADE`);

		console.log("✅ All tables truncated\n");

		// Step 2: Insert models (one row per model/account)
		console.log("📦 Inserting models...");

		let totalInserted = 0;
		for (const definition of MODEL_DEFINITIONS) {
			const { openRouterModelName, variant, alpacaKeyEnv, alpacaSecretEnv } =
				definition;
			const name = extractModelName(openRouterModelName);
			const alpacaApiKey = requireEnvVar(alpacaKeyEnv);
			const alpacaApiSecret = requireEnvVar(alpacaSecretEnv);

			await db.execute(sql`
				INSERT INTO "Models" (
					"id",
					"name",
					"openRouterModelName",
					"variant",
					"alpacaApiKey",
					"alpacaApiSecret",
					"invocationCount",
					"totalMinutes"
				) VALUES (
					${crypto.randomUUID()},
					${name},
					${openRouterModelName},
					${variant},
					${alpacaApiKey},
					${alpacaApiSecret},
					0,
					0
				)
			`);

			console.log(`  ✓ Added: ${name} (${variant})`);
			totalInserted++;
		}

		console.log(`\n✅ Successfully seeded ${totalInserted} model accounts`);
	} catch (error) {
		console.error("❌ Seed failed:", error);
		process.exit(1);
	} finally {
		await pool.end();
		console.log("\n🔒 Database connection closed");
	}
}

if (import.meta.main) {
	await seed();
}
