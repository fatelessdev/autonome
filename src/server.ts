import { createStartHandler, defaultStreamHandler } from "@tanstack/react-start/server";
import { FRONTEND_PORT, API_URL } from "@/env";
import { stat } from "node:fs/promises";
import { join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

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
