import { createStartHandler, defaultStreamHandler } from "@tanstack/react-start/server";
import { stat } from "node:fs/promises";
import { join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

// Use import.meta.env directly to avoid loading backend-only env validation
// On Vercel, backend env vars don't exist - frontend proxies to VPS API
const FRONTEND_PORT = Number(import.meta.env.FRONTEND_PORT) || 5173;
const API_URL = import.meta.env.VITE_API_URL || import.meta.env.API_URL || "http://localhost:8081";

declare const Bun: any;

const startHandler = createStartHandler(defaultStreamHandler);
const clientDistDir = fileURLToPath(new URL("../client", import.meta.url));

async function serveStatic(request: Request): Promise<Response | null> {
	const url = new URL(request.url);
	const pathname = decodeURIComponent(url.pathname);
	const normalizedPath = normalize(pathname).replace(/^([./\\]+)?/, "");

	// Only attempt to serve known files under the client dist directory
	if (!normalizedPath) return null;
	const filePath = join(clientDistDir, normalizedPath);
	if (!filePath.startsWith(clientDistDir)) return null;

	try {
		const fileInfo = await stat(filePath);
		if (!fileInfo.isFile()) return null;

		const file = Bun.file(filePath);
		const cacheHeader = normalizedPath.startsWith("assets/")
			? "public, max-age=31536000, immutable"
			: "public, max-age=3600";

		return new Response(file, {
			headers: {
				"Cache-Control": cacheHeader,
			},
		});
	} catch {
		return null;
	}
}

export default {
	port: FRONTEND_PORT,
	async fetch(request: Request) {
		const url = new URL(request.url);

		// Proxy ONLY backend-owned routes to the VPS API.
		// TanStack Start also serves its own server routes under `/api/*` (e.g. `/api/chat`).
		const shouldProxyToApi =
			url.pathname.startsWith("/api/rpc") ||
			url.pathname.startsWith("/api/events") ||
			url.pathname === "/api/health" ||
			url.pathname === "/api/health/schedulers";
		if (shouldProxyToApi) {
			const targetUrl = new URL(url.pathname + url.search, API_URL);
			return fetch(targetUrl, {
				method: request.method,
				headers: request.headers,
				body: request.body,
			});
		}

		// When running on Vercel (Nitro), static assets are handled by the platform/CDN.
		// We can skip the potentially fragile Bun.file() logic.
		if (!process.env.VERCEL) {
			const staticResponse = await serveStatic(request);
			if (staticResponse) return staticResponse;
		}
		
		return startHandler(request);
	},
};
