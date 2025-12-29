import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import viteTsConfigPaths from "vite-tsconfig-paths";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
	plugins: [
		viteTsConfigPaths({
			projects: ["./tsconfig.json"],
		}),
		tailwindcss(),
		TanStackRouterVite({
			routesDirectory: "./src/routes",
			generatedRouteTree: "./src/routeTree.gen.ts",
		}),
		react({
			babel: {
				plugins: ["babel-plugin-react-compiler"],
			},
		}),
	],
	build: {
		rollupOptions: {
			output: {
				advancedChunks: {
					groups: [
						{
							name: "react-vendor",
							test: /node_modules\/react/,
							priority: 10,
						},
						{
							name: "three-vendor",
							test: /node_modules\/three|@react-three/,
							priority: 10,
						},
						{
							name: "ui-vendor",
							test: /node_modules\/(@radix-ui|framer-motion|motion|lucide-react)/,
							priority: 10,
						},
						{
							name: "shiki-vendor",
							test: /node_modules\/shiki/,
							priority: 10,
						},
					],
				},
			},
		},
	},
	// Proxy API requests to backend during development
	server: {
		proxy: {
			"/api": {
				target: process.env.VITE_API_URL || "http://localhost:8080",
				changeOrigin: true,
			},
		},
	},
});
