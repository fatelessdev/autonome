/**
 * API Configuration
 *
 * Shared utilities for getting the API base URL across the application.
 * Used by oRPC client and SSE connections.
 */

/**
 * Get the base API URL for making requests to the backend.
 *
 * Priority:
 * 1. VITE_API_URL environment variable (for production/remote API)
 * 2. Relative path (for development with Vite proxy)
 *
 * In development, Vite proxies /api/* to the API server.
 * In production, VITE_API_URL should point to the remote API server.
 */
export function getApiBaseUrl(): string {
	// Check for environment variable first
	if (import.meta.env.VITE_API_URL) {
		return import.meta.env.VITE_API_URL.replace(/\/$/, ""); // Remove trailing slash
	}

	// In browser, use relative path (works with Vite proxy in dev)
	if (typeof window !== "undefined") {
		return window.location.origin;
	}

	// Server-side fallback (shouldn't normally be called)
	return "http://localhost:8081";
}

/**
 * Get a full SSE endpoint URL.
 *
 * @param path - The SSE endpoint path (e.g., "/api/events/trades")
 * @returns Full URL to the SSE endpoint
 */
export function getSseUrl(path: string): string {
	const base = getApiBaseUrl();
	// Ensure path starts with /
	const normalizedPath = path.startsWith("/") ? path : `/${path}`;
	return `${base}${normalizedPath}`;
}

/**
 * Get the oRPC endpoint URL.
 */
export function getRpcUrl(): string {
	return `${getApiBaseUrl()}/api/rpc`;
}
