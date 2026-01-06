import { defineEventHandler, toWebRequest } from "h3";

/**
 * Nitro handler that delegates all requests to TanStack Start.
 *
 * IMPORTANT: this imports the *built* Start server output from `dist/server/server.js`.
 * Vercel/Nitro builds must run `vite build` first.
 */
export default defineEventHandler(async (event) => {
	const request = toWebRequest(event);

	try {
		const mod = await import("../../dist/server/server.js");
		const fetch = (mod?.default?.fetch ?? mod?.fetch) as
			| ((req: Request) => Promise<Response>)
			| undefined;

		if (!fetch) {
			console.error("[Nitro] TanStack Start server entry not found or invalid exports");
			return new Response("TanStack Start server entry not found", {
				status: 500,
			});
		}

		return await fetch(request);
	} catch (error) {
		console.error("[Nitro] Error handling request:", error);
		// Return detailed error for debugging (remove in strict production if needed)
		const errorMessage = error instanceof Error ? error.stack ?? error.message : String(error);
		return new Response(`Server Error: ${errorMessage}`, {
			status: 500,
		});
	}
});
