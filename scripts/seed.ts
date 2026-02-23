/**
 * Seed Script - Resets and seeds the database with initial model data
 *
 * Usage: bun run scripts/seed.ts
 *
 * This script will:
 * 1. Truncate all tables (cascade)
 * 2. Insert the predefined AI models into the Models table
 *    - Each model gets one row per variant
 */

import { config } from "dotenv";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { Pool } from "pg";
import { env } from "@/env";
import { VARIANT_IDS } from "@/core/shared/variants";

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

// Model definitions - openRouterModelName
const MODEL_DEFINITIONS = [
	//working models
	"stepfun-ai/step-3.5-flash",
	"minimaxai/minimax-m2.1",
	"z-ai/glm4.7",
	"deepseek-ai/deepseek-v3.1-terminus",
	// not working models
	// "xiaomi/mimo-v2-flash:free",
	// "kwaipilot/kat-coder-pro:free",
	// "deepseek-ai/deepseek-v3.2",
	// "mistralai/mistral-large-3-675b-instruct-2512"
	"kimi-for-coding-free",
	"coding-minimax-m2.1-free",
	"coding-glm-4.7-free",

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

async function seed() {
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

		// Step 2: Insert models (one row per model-variant combination)
		console.log("📦 Inserting models...");

		let totalInserted = 0;
		for (const openRouterModelName of MODEL_DEFINITIONS) {
			const name = extractModelName(openRouterModelName);

			for (const variant of VARIANT_IDS) {
				await db.execute(sql`
					INSERT INTO "Models" (
						"id",
						"name",
						"openRouterModelName",
						"variant",
						"lighterApiKey",
						"invocationCount",
						"totalMinutes",
						"accountIndex"
					) VALUES (
						${crypto.randomUUID()},
						${name},
						${openRouterModelName},
						${variant},
						'0',
						0,
						0,
						'0'
					)
				`);

				console.log(`  ✓ Added: ${name} (${variant})`);
				totalInserted++;
			}
		}

		console.log(`\n✅ Successfully seeded ${totalInserted} model-variant combinations`);
		console.log(`   (${MODEL_DEFINITIONS.length} models × ${VARIANT_IDS.length} variants)`);
	} catch (error) {
		console.error("❌ Seed failed:", error);
		process.exit(1);
	} finally {
		await pool.end();
		console.log("\n🔒 Database connection closed");
	}
}

// Run the seed
seed();
