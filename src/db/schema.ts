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

export const toolCallTypeEnum = pgEnum("ToolCallType", [
	"CREATE_POSITION",
	"CLOSE_POSITION",
	"HOLDING",
]);

export const orderStatusEnum = pgEnum("OrderStatus", ["OPEN", "CLOSED"]);

export const orderSideEnum = pgEnum("OrderSide", ["LONG", "SHORT"]);

export const variantEnum = pgEnum("Variant", [
	"Situational",
	"Minimal",
	"Guardian",
	"Max",
	"Sovereign",
]);

export const models = pgTable(
	"Models",
	{
		id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
		name: text("name").notNull(),
		openRouterModelName: text("openRouterModelName").notNull(),
		variant: variantEnum("variant").notNull().default("Situational"),
		lighterApiKey: text("lighterApiKey").notNull().default("0"),
		invocationCount: integer("invocationCount").notNull().default(0),
		totalMinutes: integer("totalMinutes").notNull().default(0),
		accountIndex: text("accountIndex").notNull().default("0"),
		failedWorkflowCount: integer("failedWorkflowCount").notNull().default(0),
		failedToolCallCount: integer("failedToolCallCount").notNull().default(0),
	},
	(table) => ({
		nameIdx: index("Models_name_idx").on(table.name),
		// Unique on name + variant so each model can have 5 variants
		nameVariantUnique: uniqueIndex("Models_name_variant_key").on(table.name, table.variant),
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
		netPortfolio: numeric("netPortfolio", { precision: 18, scale: 2 }).notNull(),
		createdAt: timestamp("createdAt").defaultNow().notNull(),
		updatedAt: timestamp("updatedAt").defaultNow().notNull(),
	},
	(table) => ({
		modelIdx: index("PortfolioSize_modelId_idx").on(table.modelId),
		// Composite index for efficient time-range queries per model
		modelCreatedAtIdx: index("PortfolioSize_modelId_createdAt_idx").on(table.modelId, table.createdAt),
		// Standalone index for time-based pruning/aggregation
		createdAtIdx: index("PortfolioSize_createdAt_idx").on(table.createdAt),
	}),
);

/**
 * Orders table - single source of truth for positions
 *
 * OPEN orders = active positions (shown in Positions tab)
 * CLOSED orders = completed trades (shown in Trades tab)
 *
 * Unrealized P&L is calculated live from current prices, not stored.
 * When an order is closed, exitPrice and realizedPnl are populated.
 * 
 * Note: entryNotional and exitNotional are derived (qty * price) - not stored.
 * Note: confidence is stored inside exitPlan JSONB (confidence in the plan).
 */
export const orders = pgTable(
	"Orders",
	{
		id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
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
		// Lighter exchange order indices for real SL/TP orders
		slOrderIndex: text("slOrderIndex"),
		tpOrderIndex: text("tpOrderIndex"),
		// Trigger prices for SL/TP orders (stored for reference)
		slTriggerPrice: numeric("slTriggerPrice", { precision: 18, scale: 8 }),
		tpTriggerPrice: numeric("tpTriggerPrice", { precision: 18, scale: 8 }),
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
}));

export const invocationRelations = relations(invocations, ({ one, many }) => ({
	model: one(models, {
		fields: [invocations.modelId],
		references: [models.id],
	}),
	toolCalls: many(toolCalls),
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

export const orderRelations = relations(orders, ({ one }) => ({
	model: one(models, {
		fields: [orders.modelId],
		references: [models.id],
	}),
}));

export type Model = typeof models.$inferSelect;
export type Invocation = typeof invocations.$inferSelect;
export type ToolCall = typeof toolCalls.$inferSelect;
export type PortfolioSnapshot = typeof portfolioSize.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;

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

export const Variant = {
	Situational: variantEnum.enumValues[0],
	Minimal: variantEnum.enumValues[1],
	Guardian: variantEnum.enumValues[2],
	Max: variantEnum.enumValues[3],
	Sovereign: variantEnum.enumValues[4],
} as const;

export type Variant = (typeof variantEnum.enumValues)[number];