import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "@/env.ts";
import * as schema from "./schema.ts";

/**
 * Lazy database connection singleton.
 *
 * On Vercel (frontend-only), DATABASE_URL doesn't exist because the backend
 * runs on VPS. This lazy initialization prevents crashes during SSR when
 * server code is bundled but never actually executed.
 *
 * The database is only connected when first accessed via `db` getter.
 */
let _db: NodePgDatabase<typeof schema> | null = null;
let _pool: Pool | null = null;

function getDb(): NodePgDatabase<typeof schema> {
	if (!_db) {
		if (!env.DATABASE_URL) {
			throw new Error(
				"DATABASE_URL is not defined. This code path requires database access " +
					"but is running in an environment without database configuration (e.g., Vercel frontend).",
			);
		}
		_pool = new Pool({
			connectionString: env.DATABASE_URL,
		});
		_db = drizzle(_pool, { schema });
	}
	return _db;
}

/**
 * Database client with lazy initialization.
 * Throws descriptive error if used in environment without DATABASE_URL.
 */
export const db = new Proxy({} as NodePgDatabase<typeof schema>, {
	get(_target, prop) {
		const instance = getDb();
		const value = (instance as unknown as Record<PropertyKey, unknown>)[prop];
		return typeof value === "function" ? value.bind(instance) : value;
	},
});
