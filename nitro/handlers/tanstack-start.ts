import { defineEventHandler, toWebRequest } from "h3";

/**
 * Nitro handler that delegates all requests to TanStack Start.
 *
 * IMPORTANT: this imports the *built* Start server output from `dist/server/server.js`.
 * Vercel/Nitro builds must run `vite build` first.
 */
export default defineEventHandler(async (event) => {
	const request = toWebRequest(event);

	const mod = await import("../../dist/server/server.js");
	const fetch = (mod?.default?.fetch ?? mod?.fetch) as
		| ((req: Request) => Promise<Response>)
		| undefined;

	if (!fetch) {
		return new Response("TanStack Start server entry not found", {
			status: 500,
		});
	}

	return fetch(request);
});
