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
function toRpcUrl(url: string): string {
	const trimmed = url.trim().replace(/\/$/, "");
	return trimmed.endsWith("/api/rpc") ? trimmed : `${trimmed}/api/rpc`;
}

function getApiUrl(): string {
	// Check for environment variable first (works for both client and server if configured correctly)
	if (import.meta.env.VITE_API_URL) {
		return toRpcUrl(import.meta.env.VITE_API_URL);
	}

	if (typeof window === "undefined") {
		// Server-side: shouldn't be called in normal usage, but keep a safe fallback
		return toRpcUrl("http://localhost:8081");
	}

	// Client-side: use relative path (proxied in dev, same origin in prod)
	return `${window.location.origin}/api/rpc`;
}

const link = new RPCLink({
	url: getApiUrl(),
});

export const client: RouterClient<typeof router> = createORPCClient(link);

export const orpc = createTanstackQueryUtils(client);
