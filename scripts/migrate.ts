/**
 * Migration Script
 * 
 * This script copies and transforms files from the monolith structure
 * to the new packages structure.
 * 
 * Run with: bun run scripts/migrate.ts
 */

import { existsSync, mkdirSync, cpSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");
const PACKAGES = join(ROOT, "packages");

// Ensure directories exist
function ensureDir(path: string) {
	if (!existsSync(path)) {
		mkdirSync(path, { recursive: true });
	}
}

// Copy directory recursively
function copyDir(src: string, dest: string) {
	if (!existsSync(src)) {
		console.log(`  Skipped (not found): ${src}`);
		return;
	}
	cpSync(src, dest, { recursive: true });
	console.log(`  Copied: ${src} -> ${dest}`);
}

// Copy file
function copyFile(src: string, dest: string) {
	if (!existsSync(src)) {
		console.log(`  Skipped (not found): ${src}`);
		return;
	}
	ensureDir(dirname(dest));
	cpSync(src, dest);
	console.log(`  Copied: ${src} -> ${dest}`);
}

// Transform imports in a file
function transformImports(filePath: string, transforms: Record<string, string>) {
	if (!existsSync(filePath)) return;
	
	let content = readFileSync(filePath, "utf-8");
	let changed = false;
	
	for (const [from, to] of Object.entries(transforms)) {
		const regex = new RegExp(`from ["']${from}`, "g");
		if (regex.test(content)) {
			content = content.replace(regex, `from "${to}`);
			changed = true;
		}
		// Also handle dynamic imports
		const dynamicRegex = new RegExp(`import\\(["']${from}`, "g");
		if (dynamicRegex.test(content)) {
			content = content.replace(dynamicRegex, `import("${to}`);
			changed = true;
		}
	}
	
	if (changed) {
		writeFileSync(filePath, content);
		console.log(`  Transformed imports: ${filePath}`);
	}
}

// Process all TypeScript files in a directory
function processDirectory(dir: string, transforms: Record<string, string>) {
	if (!existsSync(dir)) return;
	
	const entries = readdirSync(dir, { withFileTypes: true });
	for (const entry of entries) {
		const fullPath = join(dir, entry.name);
		if (entry.isDirectory()) {
			processDirectory(fullPath, transforms);
		} else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
			transformImports(fullPath, transforms);
		}
	}
}

console.log("🚀 Starting migration...\n");

// ============================================================================
// Step 1: Copy server code to packages/api
// ============================================================================

console.log("📦 Copying API package files...");

const API_SRC = join(PACKAGES, "api", "src");

// Copy database
copyDir(join(SRC, "db"), join(API_SRC, "db"));

// Copy oRPC router
copyDir(join(SRC, "server", "orpc", "router"), join(API_SRC, "orpc", "router"));
copyFile(join(SRC, "server", "orpc", "schema.ts"), join(API_SRC, "orpc", "schema.ts"));

// Copy features
copyDir(join(SRC, "server", "features"), join(API_SRC, "features"));

// Copy events
copyDir(join(SRC, "server", "events"), join(API_SRC, "events"));

// Copy chat
copyDir(join(SRC, "server", "chat"), join(API_SRC, "chat"));

// Copy polyfill
copyFile(join(SRC, "polyfill.ts"), join(API_SRC, "polyfill.ts"));

// Copy integrations
copyDir(join(SRC, "server", "integrations"), join(API_SRC, "integrations"));

// Copy SSE utilities
copyDir(join(SRC, "server", "sse"), join(API_SRC, "sse"));

console.log("\n📦 Copying Web package files...");

const WEB_SRC = join(PACKAGES, "web", "src");

// Copy components
copyDir(join(SRC, "components"), join(WEB_SRC, "components"));

// Copy hooks
copyDir(join(SRC, "hooks"), join(WEB_SRC, "hooks"));

// Copy lib utilities
copyDir(join(SRC, "core", "lib"), join(WEB_SRC, "lib"));

// Copy utils
copyDir(join(SRC, "core", "utils"), join(WEB_SRC, "utils"));

// Copy styles
copyFile(join(SRC, "styles.css"), join(WEB_SRC, "styles.css"));

// Copy route files (excluding api/)
const routeFiles = ["__root.tsx", "index.tsx", "analytics.tsx", "chat.tsx", "failures.tsx", "leaderboard.tsx"];
for (const file of routeFiles) {
	copyFile(join(SRC, "routes", file), join(WEB_SRC, "routes", file));
}

// Copy router.tsx
copyFile(join(SRC, "router.tsx"), join(WEB_SRC, "router.tsx"));

// ============================================================================
// Step 2: Transform imports in API package
// ============================================================================

console.log("\n🔧 Transforming API package imports...");

const apiTransforms: Record<string, string> = {
	"@/polyfill": "@/polyfill",
	"@/db": "@/db",
	"@/env": "@/env",
	"@/core/shared/trading": "@autonome/shared/trading",
	"@/core/shared/markets": "@autonome/shared/markets",
	"@/core/shared/models": "@autonome/shared/models",
	"@/core/shared/cache": "@autonome/shared/cache",
	"@/core/shared/formatting": "@autonome/shared/formatting",
	"@/shared/trading": "@autonome/shared/trading",
	"@/shared/markets": "@autonome/shared/markets",
	"@/shared/models": "@autonome/shared/models",
	"@/shared/cache": "@autonome/shared/cache",
	"@/shared/formatting": "@autonome/shared/formatting",
	"@/server/features": "@/features",
	"@/server/events": "@/events",
	"@/server/chat": "@/chat",
	"@/server/orpc": "@/orpc",
	"@/server/schedulers": "@/schedulers",
	"@/server/sse": "@/sse",
	"@/server/integrations": "@/integrations",
};

processDirectory(API_SRC, apiTransforms);

// ============================================================================
// Step 3: Transform imports in Web package
// ============================================================================

console.log("\n🔧 Transforming Web package imports...");

const webTransforms: Record<string, string> = {
	"@/server/orpc/client": "@/orpc/client",
	"@/core/shared/trading": "@autonome/shared/trading",
	"@/core/shared/markets": "@autonome/shared/markets",
	"@/core/shared/models": "@autonome/shared/models",
	"@/core/shared/cache": "@autonome/shared/cache",
	"@/core/shared/formatting": "@autonome/shared/formatting",
	"@/shared/trading": "@autonome/shared/trading",
	"@/shared/markets": "@autonome/shared/markets",
	"@/shared/models": "@autonome/shared/models",
	"@/shared/cache": "@autonome/shared/cache",
	"@/shared/formatting": "@autonome/shared/formatting",
	"@/core/lib": "@/lib",
	"@/core/utils": "@/utils",
};

processDirectory(WEB_SRC, webTransforms);

console.log("\n✅ Migration complete!");
console.log("\nNext steps:");
console.log("1. Review the MIGRATION.md for manual steps");
console.log("2. Remove SSR loaders from route files");
console.log("3. Update __root.tsx to remove server bootstrap");
console.log("4. Run: bun install");
console.log("5. Test with: bun run dev:api && bun run dev:web");
