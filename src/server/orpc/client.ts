import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";

import type router from "@/server/orpc/router";

/**
 * Get the API URL for oRPC requests.
 * In production, use VITE_API_URL env var.
 * In development, vite proxy handles /api/* routes.
 */
function getApiUrl(): string {
	if (typeof window === "undefined") {
		// Server-side: shouldn't be called, but fallback to env
		return process.env.VITE_API_URL || "http://localhost:8080";
	}
	
	// Client-side: use relative path (proxied in dev, same origin in prod)
	return `${window.location.origin}/api/rpc`;
}

const link = new RPCLink({
	url: getApiUrl(),
});

export const client: RouterClient<typeof router> = createORPCClient(link);

export const orpc = createTanstackQueryUtils(client);
