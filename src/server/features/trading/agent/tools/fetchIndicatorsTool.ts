/**
 * Fetch Indicators Tool
 * On-demand AI tool for fetching additional technical indicators from TAAPI
 * Uses Binance data - request ALL indicators you need in a single call for efficiency
 */

import { tool } from "ai";
import { z } from "zod";
import {
	taapiClient,
	AVAILABLE_TAAPI_INDICATORS,
} from "@/server/integrations/taapi";

const indicatorSchema = z.object({
	name: z.enum(AVAILABLE_TAAPI_INDICATORS),
	period: z
		.number()
		.min(1)
		.max(200)
		.optional()
		.describe(
			"Period/length for the indicator (e.g., 14 for RSI-14, 50 for EMA-50)",
		),
});

const fetchIndicatorsInputSchema = z.object({
	symbol: z
		.string()
		.describe("Asset symbol without USDT suffix (e.g., BTC, ETH, SOL)"),
	timeframe: z
		.enum(["1m", "5m", "15m", "1h", "4h", "1d"])
		.default("1h")
		.describe("Candle timeframe for indicator calculation"),
	indicators: z
		.array(indicatorSchema)
		.min(1)
		.max(10)
		.describe(
			"List of indicators to fetch. Include period where applicable. Request all at once for efficiency.",
		),
});

type FetchIndicatorsInput = z.infer<typeof fetchIndicatorsInputSchema>;

/**
 * Fetch additional technical indicators from TAAPI (Binance data).
 * This is a standalone tool that doesn't require context - it can be used directly.
 */
export const fetchIndicatorsTool = tool({
	description: `Fetch additional technical indicators from TAAPI (uses Binance data).
Use when you need indicators not in the standard market data (EMA20, MACD, RSI7/14, ATR10/14, EMA50).
Available indicators: ${AVAILABLE_TAAPI_INDICATORS.join(", ")}.
IMPORTANT: Request ALL indicators you need in a SINGLE call - they are fetched in bulk for efficiency.
For example, if you want stochrsi, ichimoku, and bbands, request all three at once.`,

	inputSchema: fetchIndicatorsInputSchema,

	execute: async ({ symbol, timeframe, indicators }: FetchIndicatorsInput) => {
		// Check if TAAPI is configured
		if (!taapiClient.isConfigured()) {
			return JSON.stringify({
				error: true,
				message:
					"TAAPI_API_KEY not configured. Cannot fetch additional indicators.",
				hint: "Add TAAPI_API_KEY to your .env file to enable this feature.",
			});
		}

		try {
			const normalizedSymbol = `${symbol.toUpperCase()}/USDT`;

			// Build indicator configs with unique IDs
			const configs = indicators.map((ind) => ({
				id: ind.period ? `${ind.name}${ind.period}` : ind.name,
				indicator: ind.name,
				...(ind.period && { period: ind.period }),
			}));

			// Generate cache key from the indicator combination
			const cacheKey = `tool-${configs.map((c) => c.id).join("-")}`;

			// Bulk fetch all requested indicators
			const results = await taapiClient.fetchBulkIndicators(
				normalizedSymbol,
				timeframe,
				configs,
				cacheKey,
			);

			// Format results for AI consumption
			const formatted: Record<string, unknown> = {};
			for (const [id, value] of Object.entries(results)) {
				if (value === null) {
					formatted[id] = "Error fetching indicator";
				} else {
					formatted[id] = value;
				}
			}

			return JSON.stringify(
				{
					symbol,
					timeframe,
					indicators: formatted,
					fetchedAt: new Date().toISOString(),
					source: "TAAPI (Binance data)",
				},
				null,
				2,
			);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.error("[fetchIndicatorsTool] Error:", message);
			return JSON.stringify({
				error: true,
				message: `Failed to fetch indicators: ${message}`,
				hint: "Try again in a few seconds if rate limited. Free plan allows 1 request per 15 seconds.",
			});
		}
	},
});
