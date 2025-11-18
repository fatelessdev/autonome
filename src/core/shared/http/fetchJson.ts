export class HttpError extends Error {
	constructor(
		message: string,
		public readonly response: Response,
		public readonly body: string,
	) {
		super(message);
		this.name = "HttpError";
	}
}

export type FetchJsonInit = RequestInit & {
	/**
	 * Optional transformer invoked with the parsed JSON payload.
	 * Use this to coerce/validate the raw data before returning it.
	 */
	transform?: <TInput, TOutput>(payload: TInput) => TOutput;
};

const DEFAULT_HEADERS = {
	Accept: "application/json",
} as const;

/**
 * Small wrapper around fetch that enforces no-store caching, surfaces readable errors,
 * and guarantees JSON parsing before returning the payload.
 */
export async function fetchJson<TPayload>(
	input: RequestInfo | URL,
	init: FetchJsonInit = {},
): Promise<TPayload> {
	const { transform, headers, cache, ...rest } = init;
	const response = await fetch(input, {
		cache: cache ?? "no-store",
		headers: { ...DEFAULT_HEADERS, ...headers },
		...rest,
	});

	const rawText = await readBody(response);

	if (!response.ok) {
		throw new HttpError(
			`[fetchJson] ${response.status} ${response.statusText}`,
			response,
			rawText,
		);
	}

	let parsed: unknown = rawText.length ? safeJsonParse(rawText) : null;

	if (typeof transform === "function") {
		parsed = transform(parsed);
	}

	return parsed as TPayload;
}

function safeJsonParse(payload: string): unknown {
	try {
		return JSON.parse(payload);
	} catch (error) {
		throw new Error(
			`[fetchJson] Failed to parse JSON: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}
}

async function readBody(response: Response): Promise<string> {
	try {
		return await response.text();
	} catch {
		return "";
	}
}
