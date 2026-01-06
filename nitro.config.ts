import { defineNitroConfig } from "nitropack/config";

export default defineNitroConfig({
	preset: "vercel",
	// Required for Vercel Observability routing hints (Nitro >= 2.12)
	compatibilityDate: "2025-07-15",

	// IMPORTANT: this repo already has an `api/` folder for the VPS Hono backend.
	// Nitro defaults to scanning `api/` for server routes, which would incorrectly
	// bundle the VPS backend into the Vercel frontend deployment.
	srcDir: "nitro",
	scanDirs: ["nitro"],
	apiDir: "nitro/api",
	routesDir: "nitro/routes",

	// TanStack Start's built server entry uses `import.meta.url`.
	// Ensure Nitro's bundling target preserves `import.meta`.
	esbuild: {
		options: {
			target: "es2022",
		},
	},

	// Deploy server functions using Bun on Vercel
	vercel: {
		functions: {
			runtime: "bun1.x",
		},
	},

	// Vite (TanStack Start) builds the client bundle into dist/client
	// Nitro will copy/serve it as static assets.
	publicAssets: [
		{
			dir: "dist/client/assets",
			baseURL: "/assets",
			maxAge: 60 * 60 * 24 * 365,
			immutable: true,
		},
		{
			dir: "dist/client",
			baseURL: "/",
			maxAge: 60 * 60,
		},
	],

	// Route everything (SSR + file routes like /api/chat) through TanStack Start's
	// built server handler.
	handlers: [
		{
			route: "/**",
			handler: "./nitro/handlers/tanstack-start",
		},
	],
});
