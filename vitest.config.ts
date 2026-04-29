import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		include: ["src/**/*.test.ts", "api/**/*.test.ts"],
		testTimeout: 30000,
		hookTimeout: 30000,
		coverage: {
			provider: "v8",
			include: ["src/**/*.{ts,tsx}", "api/**/*.ts"],
			exclude: [
				"src/**/*.test.ts",
				"src/**/*.d.ts",
				"src/routeTree.gen.ts",
			],
		},
	},
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "./src"),
		},
	},
});
