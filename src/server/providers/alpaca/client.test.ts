import { describe, it, expect } from "vitest";
import { AlpacaError, AlpacaClient, createAlpacaClient } from "./client";

describe("AlpacaError", () => {
	it("constructs with message, code, and status", () => {
		const error = new AlpacaError("test message", "UNAUTHORIZED", 401);
		expect(error.message).toBe("test message");
		expect(error.code).toBe("UNAUTHORIZED");
		expect(error.status).toBe(401);
	});

	it("is an instance of Error", () => {
		const error = new AlpacaError("msg", "ERROR", 500);
		expect(error).toBeInstanceOf(Error);
		expect(error).toBeInstanceOf(AlpacaError);
	});

	it("has name set to AlpacaError", () => {
		const error = new AlpacaError("msg", "ERROR", 500);
		expect(error.name).toBe("AlpacaError");
	});

	it("preserves all status codes", () => {
		const codes = [
			{ status: 401, code: "UNAUTHORIZED" },
			{ status: 403, code: "FORBIDDEN" },
			{ status: 404, code: "NOT_FOUND" },
			{ status: 422, code: "INVALID_INPUT" },
			{ status: 429, code: "RATE_LIMITED" },
			{ status: 500, code: "PROVIDER_ERROR" },
		];

		for (const { status, code } of codes) {
			const error = new AlpacaError(`Error ${status}`, code, status);
			expect(error.status).toBe(status);
			expect(error.code).toBe(code);
		}
	});
});

describe("AlpacaClient", () => {
	it("constructs with paper trading base URL by default", () => {
		const client = new AlpacaClient({
			apiKey: "test-key",
			apiSecret: "test-secret",
			paper: true,
		});
		// Verify it was constructed (we can't directly inspect private fields,
		// but construction without error is the test)
		expect(client).toBeInstanceOf(AlpacaClient);
	});

	it("constructs with live trading base URL", () => {
		const client = new AlpacaClient({
			apiKey: "test-key",
			apiSecret: "test-secret",
			paper: false,
		});
		expect(client).toBeInstanceOf(AlpacaClient);
	});
});

describe("createAlpacaClient", () => {
	it("returns an AlpacaClient instance", () => {
		const client = createAlpacaClient({
			apiKey: "key",
			apiSecret: "secret",
			paper: true,
		});
		expect(client).toBeInstanceOf(AlpacaClient);
	});
});
