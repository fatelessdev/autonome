import { google } from "@ai-sdk/google";
import { QueryClient } from "@tanstack/react-query";
import { tool as createTool, generateObject } from "ai";
import { z } from "zod";
import { ToolCallType } from "@/server/db/tradingRepository";
import {
	executeUnsafeQueryMutation,
	listModelsOrderedQuery,
	portfolioSnapshotsQuery,
	recentToolCallsWithModelQuery,
	searchModelsQuery,
} from "@/server/db/tradingRepository.server";
import { portfolioQuery } from "@/server/features/trading/getPortfolio.server";
import { openPositionsQuery } from "@/server/features/trading/openPositions.server";
import { normalizeNumber } from "@/shared/formatting/numberFormat";
import { getArray, safeJsonParse } from "@/utils/json";

const MAX_RESULT_ROWS = 100;

/**
 * Schema for SQL generation by AI model
 * Ensures the AI provides both the query and reasoning
 */
const SQL_GENERATION_SCHEMA = z.object({
	sql: z
		.string()
		.describe(
			"A single PostgreSQL query that answers the question. Must be read-only (SELECT or WITH). " +
				"Always include LIMIT clause. Use proper table/column quoting.",
		),
	reasoning: z
		.string()
		.describe(
			"Brief explanation of the query logic, what tables are joined, and what the results represent.",
		),
	expectedColumns: z
		.array(z.string())
		.optional()
		.describe("Expected column names in the result set for validation."),
});

/**
 * Enforces read-only SQL constraints and adds LIMIT if missing
 * Throws error if SQL contains forbidden operations
 */
function enforceReadOnly(sql: string): string {
	const trimmed = sql.trim();

	// Check for forbidden operations
	const forbidden =
		/(INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE|GRANT|REVOKE|CREATE|MERGE|CALL|EXECUTE|REPLACE|COMMENT|VACUUM)\b/i;
	if (forbidden.test(trimmed)) {
		const match = trimmed.match(forbidden);
		throw new Error(
			`Generated SQL contains forbidden operation: ${match?.[1]}. Only SELECT and WITH queries are allowed.`,
		);
	}

	// Must start with SELECT or WITH
	if (!/^(SELECT|WITH)\b/i.test(trimmed)) {
		throw new Error(
			"Generated SQL must start with SELECT or WITH. Received: " +
				trimmed.substring(0, 50) +
				"...",
		);
	}

	// Remove trailing semicolon for consistent formatting
	const withoutSemicolon = trimmed.endsWith(";")
		? trimmed.slice(0, -1)
		: trimmed;

	// Add LIMIT if not present
	const hasLimit = /LIMIT\s+\d+/i.test(withoutSemicolon);
	if (hasLimit) {
		return withoutSemicolon;
	}

	return `${withoutSemicolon}\nLIMIT ${MAX_RESULT_ROWS}`;
}

/**
 * Coerces database row to JSON-safe format
 * Handles Date, BigInt, and nested objects
 */
function coerceRow(row: unknown): Record<string, unknown> {
	if (!row || typeof row !== "object") {
		return {};
	}

	return Object.fromEntries(
		Object.entries(row as Record<string, unknown>).map(([key, value]) => {
			// Convert Date to ISO string
			if (value instanceof Date) {
				return [key, value.toISOString()];
			}

			// Convert BigInt to number or string (avoid JSON serialization errors)
			if (typeof value === "bigint") {
				const asNumber = Number(value);
				return [
					key,
					Number.isSafeInteger(asNumber) ? asNumber : value.toString(),
				];
			}

			// Handle nested objects/arrays
			if (typeof value === "object" && value !== null) {
				try {
					// Ensure proper JSON serialization
					return [key, JSON.parse(JSON.stringify(value))];
				} catch {
					return [key, String(value)];
				}
			}

			return [key, value];
		}),
	);
}

/**
 * Validates SQL query result against expected structure
 */
function validateQueryResult(
	rows: unknown[],
	expectedColumns?: string[],
): { valid: boolean; warnings: string[] } {
	const warnings: string[] = [];

	if (rows.length === 0) {
		warnings.push(
			"Query returned no results. Consider broadening search criteria.",
		);
		return { valid: true, warnings };
	}

	if (expectedColumns && expectedColumns.length > 0 && rows.length > 0) {
		const actualColumns = Object.keys(rows[0] as Record<string, unknown>);
		const missing = expectedColumns.filter(
			(col) => !actualColumns.includes(col),
		);

		if (missing.length > 0) {
			warnings.push(
				`Expected columns not found in results: ${missing.join(", ")}. ` +
					`Actual columns: ${actualColumns.join(", ")}`,
			);
		}
	}

	return { valid: true, warnings };
}

/**
 * AI-powered SQL query tool for portfolio analytics
 * Translates natural language questions into safe, read-only SQL queries
 *
 * Examples:
 * - "Show me the top 3 models by portfolio value"
 * - "How many trades did each model execute this week?"
 * - "What's the total PnL across all closed positions?"
 * - "Show recent portfolio growth for models with 'gpt' in their name"
 */
export const queryPortfolioSql = createTool({
	description:
		"Translate a natural language analytics question into a read-only SQL query over Autonome's trading database and return the results. " +
		"Best for: aggregations, trends, comparisons, historical analysis, and complex multi-table queries. " +
		"The tool will generate SQL, validate it's safe (read-only), execute it, and return formatted results. " +
		"Examples: 'top performing models', 'trade history for X', 'portfolio trends', 'PnL calculations'.",
	inputSchema: z.object({
		question: z
			.string()
			.describe(
				"User's natural language analytics question about models, portfolios, trades, or invocations. " +
					"Be specific about time ranges, model names, or metrics of interest.",
			),
	}),
	execute: async ({ question }) => {
		try {
			// Generate SQL using AI
			const generation = await generateObject({
				model: google("gemini-2.5-pro"),
				prompt: `User question: ${question}\n\nGenerate a PostgreSQL query that answers this question accurately.`,
				schema: SQL_GENERATION_SCHEMA,
			});

			// Validate and enforce read-only constraints
			let sql: string;
			try {
				sql = enforceReadOnly(generation.object.sql);
			} catch (validationError) {
				const errorMessage =
					validationError instanceof Error
						? validationError.message
						: "SQL validation failed";

				return {
					question,
					error: errorMessage,
					reasoning: generation.object.reasoning,
					generatedSql: generation.object.sql,
				};
			}

			// Execute the query with timing
			const startedAt = Date.now();
			let rawRows: unknown[];

			try {
				rawRows = await executeUnsafeQueryMutation(sql);
			} catch (executionError) {
				const errorMessage =
					executionError instanceof Error
						? executionError.message
						: "Query execution failed";

				return {
					question,
					sql,
					error: `Database error: ${errorMessage}`,
					reasoning: generation.object.reasoning,
				};
			}

			const durationMs = Date.now() - startedAt;

			// Coerce and limit results
			const rows = rawRows.slice(0, MAX_RESULT_ROWS).map(coerceRow);
			const columns = rows.length > 0 ? Object.keys(rows[0]!) : [];

			// Validate results
			const validation = validateQueryResult(
				rows,
				generation.object.expectedColumns,
			);

			return {
				question,
				sql,
				durationMs,
				rowCount: rows.length,
				truncated: rawRows.length > rows.length,
				columns,
				rows,
				reasoning: generation.object.reasoning,
				warnings:
					validation.warnings.length > 0 ? validation.warnings : undefined,
			};
		} catch (error) {
			// Catch-all for unexpected errors (network issues, timeouts, etc.)
			const errorMessage =
				error instanceof Error ? error.message : "An unexpected error occurred";

			return {
				question,
				error: `Failed to generate or execute query: ${errorMessage}`,
			};
		}
	},
});

/**
 * Get overview of AI trading models
 * Returns model metadata including invocation counts and runtime statistics
 */
export const getModelsOverview = createTool({
	description:
		"Fetch model metadata such as name, router model, invocation counts, and tracked minutes. " +
		"Best for: listing all models, finding specific models by name, checking model activity levels. " +
		"Use this for simple model lookups before using other tools that require exact model names.",
	inputSchema: z.object({
		search: z
			.string()
			.describe(
				"Optional case-insensitive substring to filter model names or router model names. " +
					"Examples: 'gpt', 'claude', 'llama'. Leave empty to get all models.",
			)
			.optional(),
		limit: z
			.number()
			.int()
			.min(1)
			.max(25)
			.default(10)
			.describe("Maximum number of models to return (1-25, default 10)"),
	}),
	execute: async ({ search, limit }) => {
		const queryClient = new QueryClient();

		try {
			const models = await queryClient.fetchQuery(
				searchModelsQuery({ search, limit }),
			);

			if (models.length === 0) {
				return {
					models: [],
					message: search
						? `No models found matching search term: "${search}"`
						: "No models found in database",
				};
			}

			return {
				models: models.map((model) => ({
					id: model.id,
					name: model.name,
					routerModel: model.openRouterModelName,
					invocationCount: model.invocationCount,
					totalMinutes: model.totalMinutes,
					accountIndex: model.accountIndex,
				})),
				count: models.length,
				searchTerm: search,
			};
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			return {
				models: [],
				error: `Failed to fetch models: ${errorMessage}`,
			};
		}
	},
});

/**
 * Get historical portfolio value snapshots
 * Returns time-series data of portfolio values for trend analysis
 */
export const getPortfolioHistory = createTool({
	description:
		"Return recent portfolio history entries with normalized numeric totals. " +
		"Best for: tracking portfolio performance over time, analyzing growth trends, comparing portfolio values. " +
		"Each entry includes the portfolio value at a specific timestamp. " +
		"Use this to visualize portfolio changes or calculate growth rates.",
	inputSchema: z.object({
		modelName: z
			.string()
			.describe(
				"Optional exact model name to filter by (case-insensitive partial match). " +
					"Leave empty to get snapshots for all models.",
			)
			.optional(),
		limit: z
			.number()
			.int()
			.min(1)
			.max(200)
			.default(60)
			.describe("Maximum number of snapshots to return (1-200, default 60)"),
	}),
	execute: async ({ modelName, limit }) => {
		const queryClient = new QueryClient();

		try {
			const snapshots = await queryClient.fetchQuery(
				portfolioSnapshotsQuery({ modelName, limit }),
			);

			if (snapshots.length === 0) {
				return {
					snapshots: [],
					message: modelName
						? `No portfolio snapshots found for model: "${modelName}"`
						: "No portfolio snapshots found",
				};
			}

			return {
				snapshots: snapshots.map(({ snapshot, model }) => {
					const totalNumeric = normalizeNumber(snapshot.netPortfolio);
					return {
						id: snapshot.id,
						modelId: snapshot.modelId,
						modelName: model.name,
						routerModel: model.openRouterModelName,
						netPortfolioRaw: snapshot.netPortfolio,
						netPortfolio: totalNumeric,
						createdAt: snapshot.createdAt.toISOString(),
						updatedAt: snapshot.updatedAt.toISOString(),
					};
				}),
				count: snapshots.length,
				modelFilter: modelName,
			};
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			return {
				snapshots: [],
				error: `Failed to fetch portfolio history: ${errorMessage}`,
			};
		}
	},
});

/**
 * Get current open positions and portfolio liquidity
 * Fetches live position data from the trading API
 */
export const getOpenPositionsTool = createTool({
	description:
		"Fetch current open positions and portfolio liquidity for tracked models. " +
		"Best for: checking current market exposure, analyzing active trades, viewing available cash. " +
		"Returns live data from the trading platform including position details (symbol, side, quantity, entry price, PnL). " +
		"Use this to understand what positions are currently held and portfolio composition.",
	inputSchema: z.object({
		modelName: z
			.string()
			.describe(
				"Optional exact model name to inspect (case-sensitive). " +
					"Leave empty to get positions for all models.",
			)
			.optional(),
	}),
	execute: async ({ modelName }) => {
		const queryClient = new QueryClient();

		try {
			const allModels = await queryClient.fetchQuery(listModelsOrderedQuery());
			const models = modelName
				? allModels.filter(
						(model) =>
							model.name.localeCompare(modelName, undefined, {
								sensitivity: "accent",
							}) === 0,
					)
				: allModels;

			if (models.length === 0) {
				return {
					positions: [],
					message: modelName
						? `No model found with exact name: "${modelName}"`
						: "No models found in database",
				};
			}

			const results = await Promise.all(
				models.map(async (model) => {
					try {
						const [positions, portfolio] = await Promise.all([
							queryClient.fetchQuery(
								openPositionsQuery({
									apiKey: model.lighterApiKey,
									accountIndex: model.accountIndex,
									id: model.id,
									modelName: model.openRouterModelName,
									name: model.name,
									invocationCount: model.invocationCount,
									totalMinutes: model.totalMinutes,
								}),
							),
							queryClient.fetchQuery(
								portfolioQuery({
									apiKey: model.lighterApiKey,
									accountIndex: model.accountIndex,
									id: model.id,
									invocationCount: model.invocationCount,
									modelName: model.openRouterModelName,
									name: model.name,
									totalMinutes: model.totalMinutes,
								}),
							),
						]);

						return {
							modelId: model.id,
							modelName: model.name,
							routerModel: model.openRouterModelName,
							totalPortfolioValue: portfolio.totalValue,
							availableCash: portfolio.availableCash,
							positionsCount: positions.length,
							positions,
						};
					} catch (error) {
						const message =
							error instanceof Error ? error.message : String(error);
						return {
							modelId: model.id,
							modelName: model.name,
							routerModel: model.openRouterModelName,
							error: `Failed to fetch positions: ${message}`,
						};
					}
				}),
			);

			return {
				positions: results,
				count: results.length,
				modelFilter: modelName,
			};
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			return {
				positions: [],
				error: `Failed to fetch open positions: ${errorMessage}`,
			};
		}
	},
});

/**
 * Get recently closed trades with PnL information
 * Extracts trade details from CLOSE_POSITION tool call metadata
 */
export const getRecentTradesTool = createTool({
	description:
		"Return recently closed trades derived from CLOSE_POSITION tool calls. " +
		"Best for: analyzing trade profitability, reviewing trading history, calculating win rates. " +
		"Each entry includes parsed position details: symbol, side, quantity, entry/exit prices, and net PnL. " +
		"Use this to evaluate model trading performance and identify profitable/unprofitable trades.",
	inputSchema: z.object({
		modelName: z
			.string()
			.describe(
				"Optional exact model name to filter by (case-insensitive partial match). " +
					"Leave empty to get trades for all models.",
			)
			.optional(),
		limit: z
			.number()
			.int()
			.min(1)
			.max(100)
			.default(25)
			.describe(
				"Maximum number of trade entries to inspect (1-100, default 25)",
			),
	}),
	execute: async ({ modelName, limit }) => {
		const queryClient = new QueryClient();

		try {
			const closeCalls = await queryClient.fetchQuery(
				recentToolCallsWithModelQuery({
					type: ToolCallType.CLOSE_POSITION,
					modelName,
					limit,
				}),
			);

			if (closeCalls.length === 0) {
				return {
					trades: [],
					message: modelName
						? `No closed trades found for model: "${modelName}"`
						: "No closed trades found",
				};
			}

			const trades = closeCalls.map((call) => {
				const metadata = safeJsonParse<Record<string, unknown>>(
					call.metadata,
					{},
				);
				const closedPositions = getArray<Record<string, unknown>>(
					metadata.closedPositions,
				);

				const parsedPositions = closedPositions.map((position) => ({
					symbol: typeof position.symbol === "string" ? position.symbol : null,
					side: typeof position.side === "string" ? position.side : null,
					quantity: normalizeNumber(position.quantity),
					entryPrice: normalizeNumber(
						position.entryPrice ?? position.markPrice,
					),
					exitPrice: normalizeNumber(position.exitPrice ?? position.markPrice),
					netPnl: normalizeNumber(
						position.netPnl ?? position.realizedPnl ?? position.unrealizedPnl,
					),
				}));

				return {
					id: call.id,
					modelId: call.modelId,
					modelName: call.modelName,
					routerModel: call.routerModel,
					createdAt: call.createdAt.toISOString(),
					positionsCount: parsedPositions.length,
					parsedPositions,
					rawMetadata: metadata,
				};
			});

			// Calculate summary statistics
			const totalPositionsClosed = trades.reduce(
				(sum, trade) => sum + trade.positionsCount,
				0,
			);
			const totalPnl = trades.reduce(
				(sum, trade) =>
					sum +
					trade.parsedPositions.reduce(
						(pnlSum, pos) => pnlSum + (pos.netPnl || 0),
						0,
					),
				0,
			);

			return {
				trades,
				count: trades.length,
				totalPositionsClosed,
				totalPnl: Math.round(totalPnl * 100) / 100, // Round to 2 decimals
				modelFilter: modelName,
			};
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			return {
				trades: [],
				error: `Failed to fetch recent trades: ${errorMessage}`,
			};
		}
	},
});

/**
 * Compare model performance metrics
 * Provides comparative analysis across multiple models
 */
export const compareModelsPerformance = createTool({
	description:
		"Compare performance metrics across multiple trading models. " +
		"Best for: identifying top performers, comparing strategies, benchmarking models. " +
		"Returns aggregated metrics including invocation counts, trading activity, and portfolio values. " +
		"Use this to quickly see which models are most active or which have the best portfolio performance.",
	inputSchema: z.object({
		modelNames: z
			.array(z.string())
			.min(1)
			.max(10)
			.describe(
				"Array of model names to compare (1-10 models). " +
					"Leave empty or provide empty array to compare all models.",
			)
			.optional(),
		includeRecentTrades: z
			.boolean()
			.default(false)
			.describe(
				"Whether to include recent trade statistics (slower but more detailed)",
			),
	}),
	execute: async ({ modelNames, includeRecentTrades }) => {
		const queryClient = new QueryClient();

		try {
			const allModels = await queryClient.fetchQuery(listModelsOrderedQuery());

			// Filter models if specific names provided
			const targetModels =
				modelNames && modelNames.length > 0
					? allModels.filter((m) =>
							modelNames.some(
								(name) =>
									m.name.toLowerCase().includes(name.toLowerCase()) ||
									name.toLowerCase().includes(m.name.toLowerCase()),
							),
						)
					: allModels;

			if (targetModels.length === 0) {
				return {
					comparisons: [],
					message:
						modelNames && modelNames.length > 0
							? `No models found matching: ${modelNames.join(", ")}`
							: "No models found in database",
				};
			}

			const comparisons = await Promise.all(
				targetModels.map(async (model) => {
					try {
						// Get latest portfolio snapshot
						const portfolioSnapshots = await queryClient.fetchQuery(
							portfolioSnapshotsQuery({
								modelName: model.name,
								limit: 1,
							}),
						);
						const latestPortfolio = portfolioSnapshots[0];

						// Optionally get recent trades
						let tradeStats;
						if (includeRecentTrades) {
							const recentTrades = await queryClient.fetchQuery(
								recentToolCallsWithModelQuery({
									type: ToolCallType.CLOSE_POSITION,
									modelName: model.name,
									limit: 50,
								}),
							);

							const positions = recentTrades.flatMap((call) => {
								const metadata = safeJsonParse<Record<string, unknown>>(
									call.metadata,
									{},
								);
								return getArray<Record<string, unknown>>(
									metadata.closedPositions,
								);
							});

							const totalPnl = positions.reduce(
								(sum, pos) =>
									sum +
									(normalizeNumber(
										pos.netPnl ?? pos.realizedPnl ?? pos.unrealizedPnl,
									) ?? 0),
								0,
							);

							const profitableTrades = positions.filter(
								(pos) =>
									(normalizeNumber(
										pos.netPnl ?? pos.realizedPnl ?? pos.unrealizedPnl,
									) ?? 0) > 0,
							).length;

							tradeStats = {
								totalTrades: recentTrades.length,
								totalPositions: positions.length,
								profitablePositions: profitableTrades,
								winRate:
									positions.length > 0
										? Math.round((profitableTrades / positions.length) * 100)
										: 0,
								totalPnl: Math.round(totalPnl * 100) / 100,
							};
						}

						return {
							modelId: model.id,
							modelName: model.name,
							routerModel: model.openRouterModelName,
							invocationCount: model.invocationCount,
							totalMinutes: model.totalMinutes,
							accountIndex: model.accountIndex,
							latestPortfolioValue: latestPortfolio
								? normalizeNumber(latestPortfolio.snapshot.netPortfolio)
								: null,
							latestPortfolioDate: latestPortfolio
								? latestPortfolio.snapshot.createdAt.toISOString()
								: null,
							tradeStats,
						};
					} catch (error) {
						const errorMessage =
							error instanceof Error ? error.message : String(error);
						return {
							modelId: model.id,
							modelName: model.name,
							routerModel: model.openRouterModelName,
							error: `Failed to fetch comparison data: ${errorMessage}`,
						};
					}
				}),
			);

			// Sort by portfolio value (descending)
			const sorted = comparisons.sort((a, b) => {
				const aVal = a.latestPortfolioValue ?? 0;
				const bVal = b.latestPortfolioValue ?? 0;
				return bVal - aVal;
			});

			return {
				comparisons: sorted,
				count: sorted.length,
				timestamp: new Date().toISOString(),
			};
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			return {
				comparisons: [],
				error: `Failed to compare models: ${errorMessage}`,
			};
		}
	},
});

export const tools = {
	queryPortfolioSql,
	getModelsOverview,
	getPortfolioHistory,
	getOpenPositionsTool,
	getRecentTradesTool,
	compareModelsPerformance,
};
