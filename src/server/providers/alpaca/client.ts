/**
 * Alpaca HTTP Client
 *
 * Thin fetch wrapper with dual base URLs for trading and market data APIs.
 * Ported from MAHORAGA/src/providers/alpaca/client.ts.
 */

export interface AlpacaClientConfig {
	apiKey: string;
	apiSecret: string;
	paper: boolean;
}

export class AlpacaError extends Error {
	code: string;
	status: number;

	constructor(message: string, code: string, status: number) {
		super(message);
		this.name = "AlpacaError";
		this.code = code;
		this.status = status;
	}
}

export class AlpacaClient {
	private tradingBaseUrl: string;
	private dataBaseUrl: string;
	private headers: Record<string, string>;

	constructor(config: AlpacaClientConfig) {
		this.tradingBaseUrl = config.paper
			? "https://paper-api.alpaca.markets"
			: "https://api.alpaca.markets";
		this.dataBaseUrl = "https://data.alpaca.markets";
		this.headers = {
			"APCA-API-KEY-ID": config.apiKey,
			"APCA-API-SECRET-KEY": config.apiSecret,
			"Content-Type": "application/json",
		};
	}

	async tradingRequest<T>(
		method: string,
		path: string,
		body?: unknown,
	): Promise<T> {
		const url = `${this.tradingBaseUrl}${path}`;
		return this.request<T>(method, url, body);
	}

	async dataRequest<T>(
		method: string,
		path: string,
		params?: Record<string, string | number | undefined>,
	): Promise<T> {
		let url = `${this.dataBaseUrl}${path}`;

		if (params) {
			const searchParams = new URLSearchParams();
			for (const [key, value] of Object.entries(params)) {
				if (value !== undefined) {
					searchParams.set(key, String(value));
				}
			}
			const queryString = searchParams.toString();
			if (queryString) {
				url += `?${queryString}`;
			}
		}

		return this.request<T>(method, url);
	}

	private async request<T>(
		method: string,
		url: string,
		body?: unknown,
	): Promise<T> {
		const options: RequestInit = {
			method,
			headers: this.headers,
		};

		if (body) {
			options.body = JSON.stringify(body);
		}

		const response = await fetch(url, options);

		if (!response.ok) {
			const errorBody = await response.text();
			let errorMessage: string;

			try {
				const errorJson = JSON.parse(errorBody) as { message?: string };
				errorMessage = errorJson.message ?? errorBody;
			} catch {
				errorMessage = errorBody;
			}

			const statusErrors: Record<number, string> = {
				401: "UNAUTHORIZED",
				403: "FORBIDDEN",
				404: "NOT_FOUND",
				422: "INVALID_INPUT",
				429: "RATE_LIMITED",
			};

			const errorCode = statusErrors[response.status] ?? "PROVIDER_ERROR";
			throw new AlpacaError(
				`Alpaca ${errorCode} (${response.status}): ${errorMessage}`,
				errorCode,
				response.status,
			);
		}

		if (response.status === 204) {
			return undefined as T;
		}

		return response.json() as Promise<T>;
	}
}

export function createAlpacaClient(config: AlpacaClientConfig): AlpacaClient {
	return new AlpacaClient(config);
}
