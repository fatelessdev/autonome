import { relations } from "drizzle-orm";
import {
	index,
	integer,
	jsonb,
	numeric,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";

import { DEFAULT_VARIANT, VARIANT_IDS } from "@/core/shared/variants";

export const toolCallTypeEnum = pgEnum("ToolCallType", [
	"CREATE_POSITION",
	"CLOSE_POSITION",
	"HOLDING",
]);

export const orderStatusEnum = pgEnum("OrderStatus", ["OPEN", "CLOSED"]);

export const orderSideEnum = pgEnum("OrderSide", ["LONG", "SHORT"]);

// Variant enum derived from SSOT
export const variantEnum = pgEnum("Variant", VARIANT_IDS);

export const models = pgTable(
	"Models",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		name: text("name").notNull(),
		openRouterModelName: text("openRouterModelName").notNull(),
		variant: variantEnum("variant").notNull().default(DEFAULT_VARIANT),
		alpacaApiKey: text("alpacaApiKey").notNull(),
		alpacaApiSecret: text("alpacaApiSecret").notNull(),
		invocationCount: integer("invocationCount").notNull().default(0),
		totalMinutes: integer("totalMinutes").notNull().default(0),
		failedWorkflowCount: integer("failedWorkflowCount").notNull().default(0),
		failedToolCallCount: integer("failedToolCallCount").notNull().default(0),
	},
	(table) => ({
		nameIdx: index("Models_name_idx").on(table.name),
		// Unique on name + variant so each model can have 5 variants
		nameVariantUnique: uniqueIndex("Models_name_variant_key").on(
			table.name,
			table.variant,
		),
	}),
);

export const invocations = pgTable(
	"Invocations",
	{
		id: text("id").primaryKey(),
		modelId: text("modelId")
			.notNull()
			.references(() => models.id, {
				onDelete: "restrict",
				onUpdate: "cascade",
			}),
		response: text("response").notNull(),
		responsePayload: jsonb("responsePayload"),
		createdAt: timestamp("createdAt").defaultNow().notNull(),
		updatedAt: timestamp("updatedAt").defaultNow().notNull(),
	},
	(table) => ({
		modelIdx: index("Invocations_modelId_idx").on(table.modelId),
	}),
);

export const toolCalls = pgTable(
	"ToolCalls",
	{
		id: text("id").primaryKey(),
		invocationId: text("invocationId")
			.notNull()
			.references(() => invocations.id, {
				onDelete: "restrict",
				onUpdate: "cascade",
			}),
		toolCallType: toolCallTypeEnum("toolCallType").notNull(),
		metadata: text("metadata").notNull(),
		createdAt: timestamp("createdAt").defaultNow().notNull(),
		updatedAt: timestamp("updatedAt").defaultNow().notNull(),
	},
	(table) => ({
		invocationIdx: index("ToolCalls_invocationId_idx").on(table.invocationId),
	}),
);

export const portfolioSize = pgTable(
	"PortfolioSize",
	{
		id: text("id").primaryKey(),
		modelId: text("modelId")
			.notNull()
			.references(() => models.id, {
				onDelete: "restrict",
				onUpdate: "cascade",
			}),
		netPortfolio: numeric("netPortfolio", {
			precision: 18,
			scale: 2,
		}).notNull(),
		createdAt: timestamp("createdAt").defaultNow().notNull(),
		updatedAt: timestamp("updatedAt").defaultNow().notNull(),
	},
	(table) => ({
		modelIdx: index("PortfolioSize_modelId_idx").on(table.modelId),
		// Composite index for efficient time-range queries per model
		modelCreatedAtIdx: index("PortfolioSize_modelId_createdAt_idx").on(
			table.modelId,
			table.createdAt,
		),
		// Standalone index for time-based pruning/aggregation
		createdAtIdx: index("PortfolioSize_createdAt_idx").on(table.createdAt),
	}),
);

/**
 * Orders table - lifecycle metadata for executed trades.
 *
 * OPEN/CLOSED statuses track order lifecycle in our ledger.
 * Current live positions shown in the UI come from Alpaca.
 *
 * Unrealized P&L is calculated live from broker prices, not stored.
 * When an order is closed, exitPrice and realizedPnl are populated.
 *
 * Note: entryNotional and exitNotional are derived (qty * price) - not stored.
 */
export const orders = pgTable(
	"Orders",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		modelId: text("modelId")
			.notNull()
			.references(() => models.id, {
				onDelete: "restrict",
				onUpdate: "cascade",
			}),
		// Position details
		symbol: text("symbol").notNull(),
		side: orderSideEnum("side").notNull(),
		quantity: numeric("quantity", { precision: 18, scale: 8 }).notNull(),
		leverage: numeric("leverage", { precision: 10, scale: 2 }),
		// Entry details
		entryPrice: numeric("entryPrice", { precision: 18, scale: 8 }).notNull(),
		// Exit plan (stop-loss, take-profit, confidence in the plan)
		exitPlan: jsonb("exitPlan").$type<{
			stop: number | null;
			target: number | null;
			invalidation: string | null;
			invalidationPrice: number | null;
			confidence: number | null;
			timeExit: string | null;
			cooldownUntil: string | null;
		}>(),
		// Status: OPEN = active position, CLOSED = completed trade
		status: orderStatusEnum("status").notNull().default("OPEN"),
		// Exit details (populated when closed)
		exitPrice: numeric("exitPrice", { precision: 18, scale: 8 }),
		realizedPnl: numeric("realizedPnl", { precision: 18, scale: 2 }),
		// Auto-close trigger (null = manual close, "STOP" or "TARGET" = auto)
		closeTrigger: text("closeTrigger"),
		// Alpaca broker order ID for tracking fills and status
		alpacaOrderId: text("alpacaOrderId"),
		// Timestamps
		openedAt: timestamp("openedAt").defaultNow().notNull(),
		closedAt: timestamp("closedAt"),
		updatedAt: timestamp("updatedAt").defaultNow().notNull(),
	},
	(table) => ({
		modelIdx: index("Orders_modelId_idx").on(table.modelId),
		statusIdx: index("Orders_status_idx").on(table.status),
		modelStatusIdx: index("Orders_modelId_status_idx").on(
			table.modelId,
			table.status,
		),
		symbolIdx: index("Orders_symbol_idx").on(table.symbol),
	}),
);

export const modelRelations = relations(models, ({ many }) => ({
	invocations: many(invocations),
	portfolioSnapshots: many(portfolioSize),
	orders: many(orders),
	decisionDiaries: many(decisionDiary),
	marketStates: many(marketState),
}));

export const invocationRelations = relations(invocations, ({ one, many }) => ({
	model: one(models, {
		fields: [invocations.modelId],
		references: [models.id],
	}),
	toolCalls: many(toolCalls),
	decisionDiaries: many(decisionDiary),
}));

export const toolCallRelations = relations(toolCalls, ({ one }) => ({
	invocation: one(invocations, {
		fields: [toolCalls.invocationId],
		references: [invocations.id],
	}),
}));

export const portfolioRelations = relations(portfolioSize, ({ one }) => ({
	model: one(models, {
		fields: [portfolioSize.modelId],
		references: [models.id],
	}),
}));

/**
 * DecisionDiary — per-invocation structured decision data.
 *
 * Captures the AI's decisions, market context, and model state at the time
 * of each invocation. Used for variant experiment evaluation and post-hoc analysis.
 */
export const decisionDiary = pgTable(
	"DecisionDiary",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		modelId: text("modelId")
			.notNull()
			.references(() => models.id, {
				onDelete: "restrict",
				onUpdate: "cascade",
			}),
		invocationId: text("invocationId")
			.notNull()
			.references(() => invocations.id, {
				onDelete: "restrict",
				onUpdate: "cascade",
			}),
		variant: variantEnum("variant").notNull(),
		decisions: jsonb("decisions").notNull().$type<
			Array<{
				symbol: string;
				side: "LONG" | "SHORT" | "HOLD";
				confidence: number | null;
				reasoningSummary: string | null;
			}>
		>(),
		marketSnapshot: jsonb("marketSnapshot").notNull().$type<{
			adx: number | null;
			regime: "trending" | "ranging" | "choppy" | null;
			bbandsPosition: "upper" | "middle" | "lower" | null;
			supertrendDirection: "long" | "short" | null;
		}>(),
		modelState: jsonb("modelState").notNull().$type<{
			cash: number;
			exposurePct: number;
			portfolioValue: number;
			openPositionsCount: number;
		}>(),
		createdAt: timestamp("createdAt").defaultNow().notNull(),
	},
	(table) => ({
		modelIdx: index("DecisionDiary_modelId_idx").on(table.modelId),
		createdAtIdx: index("DecisionDiary_createdAt_idx").on(table.createdAt),
		variantIdx: index("DecisionDiary_variant_idx").on(table.variant),
		modelCreatedAtIdx: index("DecisionDiary_modelId_createdAt_idx").on(
			table.modelId,
			table.createdAt,
		),
	}),
);

/**
 * MarketState — per-cycle market snapshot.
 *
 * Captures the overall market regime, ADX, top movers, active correlations,
 * and open interest summary after each trade cycle. Linked to DecisionDiary
 * entries via temporal join (nearest prior MarketState for same model).
 */
export const marketState = pgTable(
	"MarketState",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		modelId: text("modelId")
			.notNull()
			.references(() => models.id, {
				onDelete: "restrict",
				onUpdate: "cascade",
			}),
		regime: text("regime"),
		adxValue: numeric("adxValue", { precision: 10, scale: 2 }),
		topMovers: jsonb("topMovers").notNull().$type<
			Array<{
				symbol: string;
				changePct: number;
			}>
		>(),
		activeCorrelations: jsonb("activeCorrelations").notNull().$type<
			Array<{
				symbolA: string;
				symbolB: string;
				correlation: number;
			}>
		>(),
		openInterestSummary: jsonb("openInterestSummary").$type<Array<{
			symbol: string;
			openInterest: number;
			openInterestValueUsd: number;
			changePercent: number;
		}> | null>(),
		recordedAt: timestamp("recordedAt").defaultNow().notNull(),
	},
	(table) => ({
		modelIdx: index("MarketState_modelId_idx").on(table.modelId),
		recordedAtIdx: index("MarketState_recordedAt_idx").on(table.recordedAt),
		regimeIdx: index("MarketState_regime_idx").on(table.regime),
		modelRecordedAtIdx: index("MarketState_modelId_recordedAt_idx").on(
			table.modelId,
			table.recordedAt,
		),
	}),
);

export const orderRelations = relations(orders, ({ one }) => ({
	model: one(models, {
		fields: [orders.modelId],
		references: [models.id],
	}),
}));

export const decisionDiaryRelations = relations(decisionDiary, ({ one }) => ({
	model: one(models, {
		fields: [decisionDiary.modelId],
		references: [models.id],
	}),
	invocation: one(invocations, {
		fields: [decisionDiary.invocationId],
		references: [invocations.id],
	}),
}));

export const marketStateRelations = relations(marketState, ({ one }) => ({
	model: one(models, {
		fields: [marketState.modelId],
		references: [models.id],
	}),
}));

export type Model = typeof models.$inferSelect;
export type Invocation = typeof invocations.$inferSelect;
export type ToolCall = typeof toolCalls.$inferSelect;
export type PortfolioSnapshot = typeof portfolioSize.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;
export type DecisionDiaryEntry = typeof decisionDiary.$inferSelect;
export type NewDecisionDiaryEntry = typeof decisionDiary.$inferInsert;
export type MarketStateEntry = typeof marketState.$inferSelect;
export type NewMarketStateEntry = typeof marketState.$inferInsert;

export const ToolCallType = {
	CREATE_POSITION: toolCallTypeEnum.enumValues[0],
	CLOSE_POSITION: toolCallTypeEnum.enumValues[1],
	HOLDING: toolCallTypeEnum.enumValues[2],
} as const;

export type ToolCallType = (typeof toolCallTypeEnum.enumValues)[number];

export const OrderStatus = {
	OPEN: orderStatusEnum.enumValues[0],
	CLOSED: orderStatusEnum.enumValues[1],
} as const;

export type OrderStatus = (typeof orderStatusEnum.enumValues)[number];

export const OrderSide = {
	LONG: orderSideEnum.enumValues[0],
	SHORT: orderSideEnum.enumValues[1],
} as const;

export type OrderSide = (typeof orderSideEnum.enumValues)[number];

// Re-export Variant type from SSOT for consistency
export type { VariantId as Variant } from "@/core/shared/variants";
