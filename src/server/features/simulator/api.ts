import { DEFAULT_SIMULATOR_OPTIONS, IS_SIMULATION_ENABLED } from "@/env";
import { ExchangeSimulator } from "@/server/features/simulator/exchangeSimulator";
import type {
	AccountSnapshot,
	MarketEvent,
	OrderSide,
} from "@/server/features/simulator/types";
import { MARKETS } from "@/shared/markets/marketMetadata";

const json = (payload: unknown, init: ResponseInit = {}) => {
	const headers = new Headers(init.headers);
	if (!headers.has("content-type")) {
		headers.set("content-type", "application/json");
	}

	return new Response(JSON.stringify(payload), {
		...init,
		headers,
	});
};

const normalizeAccountId = (value: unknown, fallback = "default") => {
	if (typeof value === "string") {
		const trimmed = value.trim();
		if (trimmed.length > 0) {
			return trimmed;
		}
	}
	return fallback;
};

async function ensureSimulator() {
	if (!IS_SIMULATION_ENABLED) {
		throw new Error("Simulation mode is disabled");
	}
	return ExchangeSimulator.bootstrap(DEFAULT_SIMULATOR_OPTIONS);
}

function normalizeSide(side: string | undefined): OrderSide {
	if (!side) {
		throw new Error("Missing order side");
	}

	const lower = side.toLowerCase();
	if (lower === "buy" || lower === "long") {
		return "buy";
	}
	if (lower === "sell" || lower === "short") {
		return "sell";
	}

	throw new Error(`Unsupported order side: ${side}`);
}

export async function handleSimOrder(request: Request) {
	try {
		const simulator = await ensureSimulator();
		const body = await request.json();
		const accountId =
			typeof body.accountId === "string" && body.accountId.trim().length > 0
				? body.accountId.trim()
				: "default";

		const symbol = String(body.symbol ?? "").trim();
		const quantity = Number(body.quantity ?? body.size);
		const side = normalizeSide(body.side);
		const orderType =
			(body.type ?? "market").toLowerCase() === "limit" ? "limit" : "market";
		const limitPrice =
			body.limitPrice !== undefined
				? Number(body.limitPrice)
				: body.price !== undefined
					? Number(body.price)
					: undefined;
		const rawLeverage =
			body.leverage !== undefined ? Number(body.leverage) : undefined;
		const leverage =
			typeof rawLeverage === "number" &&
			Number.isFinite(rawLeverage) &&
			rawLeverage > 0
				? rawLeverage
				: undefined;
		const rawConfidence =
			body.confidence !== undefined ? Number(body.confidence) : undefined;
		const confidence = Number.isFinite(rawConfidence) ? rawConfidence : null;

		if (!symbol) {
			throw new Error("Symbol is required");
		}

		if (!Number.isFinite(quantity) || quantity <= 0) {
			throw new Error("Quantity must be a positive number");
		}

		if (limitPrice !== undefined && !Number.isFinite(limitPrice)) {
			throw new Error("limitPrice must be a valid number");
		}

		const order = await simulator.placeOrder(
			{
				symbol,
				side,
				quantity,
				type: orderType,
				limitPrice,
				leverage,
				confidence,
			},
			accountId,
		);

		return json({ order });
	} catch (error) {
		const message = error instanceof Error ? error.message : "Unknown error";
		const status = message.includes("disabled") ? 400 : 500;
		return json({ error: message }, { status });
	}
}

export async function handleSimAccount(request: Request) {
	if (!IS_SIMULATION_ENABLED) {
		return json({ error: "Simulation mode is disabled" }, { status: 400 });
	}

	const url = new URL(request.url);
	const accountId = normalizeAccountId(
		url.searchParams.get("accountId"),
		"default",
	);
	const simulator = await ensureSimulator();
	const snapshot: AccountSnapshot = simulator.getAccountSnapshot(accountId);
	return json({ account: snapshot, accountId });
}

export async function handleSimAccountReset(request: Request) {
	if (!IS_SIMULATION_ENABLED) {
		return json({ error: "Simulation mode is disabled" }, { status: 400 });
	}

	const url = new URL(request.url);
	let accountId = normalizeAccountId(
		url.searchParams.get("accountId"),
		"default",
	);

	if (request.headers.get("content-type")?.includes("application/json")) {
		try {
			const body = (await request.json()) as { accountId?: string };
			accountId = normalizeAccountId(body.accountId, accountId);
		} catch (error) {
			console.warn("[Simulator] Failed to parse account reset payload", error);
		}
	}

	const simulator = await ensureSimulator();
	const snapshot = simulator.resetAccount(accountId);
	return json({ account: snapshot, accountId, reset: true });
}

export async function handleSimOrderBook(request: Request) {
	if (!IS_SIMULATION_ENABLED) {
		return json({ error: "Simulation mode is disabled" }, { status: 400 });
	}

	const url = new URL(request.url);
	const symbol = url.searchParams.get("symbol");
	if (!symbol) {
		return json(
			{ error: "symbol query parameter is required" },
			{ status: 400 },
		);
	}

	try {
		const simulator = await ensureSimulator();
		const orderBook = simulator.getOrderBook(symbol);
		return json({ orderBook });
	} catch (error) {
		const message = error instanceof Error ? error.message : "Unknown error";
		return json({ error: message }, { status: 400 });
	}
}

function buildWebSocketResponse(socket: WebSocket): Response {
	return new Response(null, {
		status: 101,
		webSocket: socket,
	} as unknown as ResponseInit);
}

export async function handleSimStream(request: Request) {
	if (!IS_SIMULATION_ENABLED) {
		return new Response("Simulation mode is disabled", { status: 400 });
	}

	const url = new URL(request.url);
	const accountParam = url.searchParams.get("accountId") ?? "default";
	const accountId =
		accountParam.trim() === "" ? "default" : accountParam.trim();

	const upgrade = request.headers.get("upgrade");
	if (!upgrade || upgrade.toLowerCase() !== "websocket") {
		return new Response("Expected websocket upgrade", { status: 400 });
	}

	const pairCtor = (
		globalThis as { WebSocketPair?: new () => [WebSocket, WebSocket] }
	).WebSocketPair;
	if (!pairCtor) {
		return new Response("WebSocketPair not supported in this runtime", {
			status: 500,
		});
	}

	const [client, server] = new pairCtor();
	const simulator = await ensureSimulator();

	(server as unknown as { accept?: () => void }).accept?.();

	const sendEvent = (event: MarketEvent) => {
		if (event.type === "account" || event.type === "trade") {
			if (event.payload.accountId !== accountId) {
				return;
			}
		}

		try {
			server.send(JSON.stringify(event));
		} catch (err) {
			console.error("[Simulator] Failed to send websocket event", err);
		}
	};

	simulator.on("book", sendEvent);
	simulator.on("trade", sendEvent);
	simulator.on("account", sendEvent);

	const teardown = () => {
		simulator.off("book", sendEvent);
		simulator.off("trade", sendEvent);
		simulator.off("account", sendEvent);
	};

	server.addEventListener("close", teardown);
	server.addEventListener("error", teardown);

	const snapshot = simulator.getAccountSnapshot(accountId);
	const accountEvent: MarketEvent = {
		type: "account",
		payload: { accountId, snapshot },
	};
	server.send(JSON.stringify(accountEvent));

	for (const symbol of Object.keys(MARKETS)) {
		try {
			const orderBook = simulator.getOrderBook(symbol);
			const bookEvent: MarketEvent = { type: "book", payload: orderBook };
			server.send(JSON.stringify(bookEvent));
		} catch (error) {
			console.warn(
				`[Simulator] Unable to send initial order book for ${symbol}`,
				error,
			);
		}
	}

	return buildWebSocketResponse(client);
}
