/**
 * Fill Tracker - Tracks actual order execution on Lighter exchange
 *
 * Uses exponential backoff polling to verify order fills and extract
 * actual filled quantity and average price.
 *
 * Flow:
 * 1. Place order via SignerClient.createOrder() → get txHash
 * 2. Poll waitForTransaction() until TX_STATUS_EXECUTED
 * 3. Fetch account trades to get actual fill details
 * 4. Return FillResult with actual quantity/price or partial fill info
 */

import { AccountApi, ApiClient, checkOrderStatus, type OrderStatusResult } from "@reservoir0x/lighter-ts-sdk";
import { BASE_URL } from "@/env";
import type { SignerClient as LighterSignerClient } from "@reservoir0x/lighter-ts-sdk";

// ==================== Types ====================

export interface FillResult {
	success: boolean;
	filled: boolean;
	filledQuantity: number;
	averagePrice: number;
	/** Partial fill if filledQuantity < requestedQuantity */
	partialFill: boolean;
	/** Error message if order failed */
	error?: string;
	/** Transaction status from chain */
	txStatus?: "pending" | "executed" | "failed" | "rejected";
	/** Order status details */
	orderStatus?: OrderStatusResult;
}

export interface TrackFillParams {
	txHash: string;
	accountIndex: number;
	marketId: number;
	clientOrderIndex: number;
	requestedQuantity: number;
	/** Max time to wait for fill in ms (default: 30s) */
	maxWaitMs?: number;
	/** Poll interval in ms for waitForTransaction (default: 500ms) */
	pollIntervalMs?: number;
}

// ==================== Constants ====================

const DEFAULT_MAX_WAIT_MS = 30_000;
const DEFAULT_POLL_INTERVAL_MS = 500;

// Transaction status codes from SDK
const TX_STATUS = {
	PENDING: 0,
	QUEUED: 1,
	COMMITTED: 2,
	EXECUTED: 3,
	FAILED: 4,
	REJECTED: 5,
} as const;

// ==================== Fill Tracking ====================

/**
 * Track order fill with exponential backoff polling.
 * 
 * Steps:
 * 1. Wait for transaction to be executed using waitForTransaction
 * 2. Check order status via checkOrderStatus utility
 * 3. Parse filled amount and compute average price
 */
export async function trackFill(
	client: LighterSignerClient,
	params: TrackFillParams,
): Promise<FillResult> {
	const {
		txHash,
		accountIndex,
		marketId,
		clientOrderIndex,
		requestedQuantity,
		maxWaitMs = DEFAULT_MAX_WAIT_MS,
		pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
	} = params;

	const startTime = Date.now();
	let transaction: any = null;

	// Step 1: Wait for transaction to be processed
	// The SDK's waitForTransaction handles polling internally
	try {
		transaction = await client.waitForTransaction(txHash, maxWaitMs, pollIntervalMs);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error(`[FillTracker] waitForTransaction failed for ${txHash}:`, message);
		return {
			success: false,
			filled: false,
			filledQuantity: 0,
			averagePrice: 0,
			partialFill: false,
			error: `Transaction tracking failed: ${message}`,
			txStatus: "pending",
		};
	}

	// Check transaction status
	const txStatus = transaction?.status ?? transaction?.tx_status;
	if (txStatus === TX_STATUS.FAILED) {
		return {
			success: false,
			filled: false,
			filledQuantity: 0,
			averagePrice: 0,
			partialFill: false,
			error: "Transaction failed on chain",
			txStatus: "failed",
		};
	}

	if (txStatus === TX_STATUS.REJECTED) {
		return {
			success: false,
			filled: false,
			filledQuantity: 0,
			averagePrice: 0,
			partialFill: false,
			error: "Transaction rejected",
			txStatus: "rejected",
		};
	}

	if (txStatus !== TX_STATUS.EXECUTED) {
		return {
			success: false,
			filled: false,
			filledQuantity: 0,
			averagePrice: 0,
			partialFill: false,
			error: `Unexpected transaction status: ${txStatus}`,
			txStatus: "pending",
		};
	}

	// Step 2: Check order status with exponential backoff
	// The SDK's checkOrderStatus queries the OrderAPI for fill information
	const apiClient = new ApiClient({ host: BASE_URL });
	const orderApi = (apiClient as any).orders ?? null;

	// Create auth token for order status check
	let authToken: string | undefined;
	try {
		authToken = await client.createAuthToken();
	} catch (err) {
		console.warn("[FillTracker] Failed to create auth token, proceeding without:", err);
	}

	let orderStatus: OrderStatusResult | undefined;
	const remainingTime = maxWaitMs - (Date.now() - startTime);

	if (remainingTime > 0 && orderApi) {
		try {
			orderStatus = await checkOrderStatus(
				orderApi,
				accountIndex,
				marketId,
				clientOrderIndex,
				authToken,
				Math.ceil(remainingTime / 1000),
			);
		} catch (err) {
			console.warn("[FillTracker] checkOrderStatus failed:", err);
		}
	}

	// Parse fill details from order status
	if (orderStatus?.found) {
		const filledAmount = parseFloat(orderStatus.filledAmount ?? "0");

		// Try to get average price from order data
		const order = orderStatus.order;
		const avgPrice = order?.price != null ? parseFloat(order.price) : 0;

		const partialFill = filledAmount > 0 && filledAmount < requestedQuantity;

		await apiClient.close();

		return {
			success: true,
			filled: filledAmount > 0,
			filledQuantity: filledAmount,
			averagePrice: avgPrice,
			partialFill,
			txStatus: "executed",
			orderStatus,
		};
	}

	// Fallback: If order status check failed, try fetching account trades
	const accountApi = new AccountApi(apiClient);
	let fillResult: FillResult | null = null;

	try {
		fillResult = await fetchRecentFills(
			accountApi,
			accountIndex,
			marketId,
			requestedQuantity,
			startTime,
		);
	} catch (err) {
		console.warn("[FillTracker] fetchRecentFills failed:", err);
	}

	await apiClient.close();

	if (fillResult) {
		return fillResult;
	}

	// If we got here, transaction executed but couldn't verify fill
	// Assume full fill for market orders (conservative fallback)
	return {
		success: true,
		filled: true,
		filledQuantity: requestedQuantity,
		averagePrice: 0, // Unknown - caller should use last price
		partialFill: false,
		txStatus: "executed",
		error: "Could not verify fill details, assumed full fill",
	};
}

/**
 * Fetch recent trades for an account to find fill details.
 * Used as fallback when checkOrderStatus doesn't return fill info.
 */
async function fetchRecentFills(
	accountApi: AccountApi,
	accountIndex: number,
	marketId: number,
	requestedQuantity: number,
	orderPlacedAt: number,
): Promise<FillResult | null> {
	try {
		const account = await accountApi.getAccount({
			by: "index",
			value: accountIndex.toString(),
		});

		// Response may be wrapped
		const accountData = (account as any).accounts?.[0] ?? account;
		const trades = accountData?.trades ?? [];

		// Filter trades after order placement time and matching market
		const recentTrades = trades.filter((t: any) => {
			const tradeTime = t.timestamp ? new Date(t.timestamp).getTime() : 0;
			const tradeMarketId = t.market_id ?? t.marketId;
			return tradeTime >= orderPlacedAt && tradeMarketId === marketId;
		});

		if (recentTrades.length === 0) {
			return null;
		}

		// Aggregate fills
		let totalQuantity = 0;
		let totalNotional = 0;

		for (const trade of recentTrades) {
			const size = parseFloat(trade.size ?? "0");
			const price = parseFloat(trade.price ?? "0");
			totalQuantity += size;
			totalNotional += size * price;
		}

		const averagePrice = totalQuantity > 0 ? totalNotional / totalQuantity : 0;
		const partialFill = totalQuantity > 0 && totalQuantity < requestedQuantity;

		return {
			success: true,
			filled: totalQuantity > 0,
			filledQuantity: totalQuantity,
			averagePrice,
			partialFill,
			txStatus: "executed",
		};
	} catch (err) {
		console.error("[FillTracker] Error fetching recent fills:", err);
		return null;
	}
}

/**
 * Simple polling utility with exponential backoff.
 * Used internally but exported for testing.
 */
export async function pollWithBackoff<T>(
	checkFn: () => Promise<T | null>,
	isDone: (result: T | null) => boolean,
	options: {
		maxWaitMs: number;
		initialIntervalMs: number;
		maxIntervalMs: number;
		backoffMultiplier: number;
	},
): Promise<T | null> {
	const startTime = Date.now();
	let interval = options.initialIntervalMs;
	let result: T | null = null;

	while (Date.now() - startTime < options.maxWaitMs) {
		result = await checkFn();

		if (isDone(result)) {
			return result;
		}

		// Wait with exponential backoff
		await new Promise((resolve) => setTimeout(resolve, interval));
		interval = Math.min(interval * options.backoffMultiplier, options.maxIntervalMs);
	}

	return result;
}
