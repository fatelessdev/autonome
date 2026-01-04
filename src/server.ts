import { createStartHandler, defaultStreamHandler } from "@tanstack/react-start/server";
import { FRONTEND_PORT, API_URL } from "@/env";
import { stat } from "node:fs/promises";
import { join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

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

		// Proxy /api requests to the backend
		if (url.pathname.startsWith("/api")) {
			const targetUrl = new URL(url.pathname + url.search, API_URL);
			return fetch(targetUrl, {
				method: request.method,
				headers: request.headers,
				body: request.body,
			});
		}

		const staticResponse = await serveStatic(request);
		if (staticResponse) return staticResponse;
		return startHandler(request);
	},
};
