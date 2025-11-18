import { relations } from "drizzle-orm";
import {
	index,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	serial,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";

// Demo todos table remains for sample routes
export const todos = pgTable("todos", {
	id: serial("id").primaryKey(),
	title: text("title").notNull(),
	createdAt: timestamp("created_at").defaultNow(),
});

// --- Trading domain tables migrated from Prisma schema ---

export const toolCallTypeEnum = pgEnum("ToolCallType", [
	"CREATE_POSITION",
	"CLOSE_POSITION",
]);

export const models = pgTable(
	"Models",
	{
		id: text("id").primaryKey(),
		name: text("name").notNull(),
		openRouterModelName: text("openRoutermodelName").notNull(),
		lighterApiKey: text("lighterApiKey").notNull(),
		invocationCount: integer("invocationCount").notNull().default(0),
		totalMinutes: integer("totalMinutes").notNull().default(0),
		accountIndex: text("accountIndex").notNull(),
	},
	(table) => ({
		nameIdx: index("Models_name_idx").on(table.name),
		nameUnique: uniqueIndex("Models_name_key").on(table.name),
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
		netPortfolio: text("netPortfolio").notNull(),
		createdAt: timestamp("createdAt").defaultNow().notNull(),
		updatedAt: timestamp("updatedAt").defaultNow().notNull(),
	},
	(table) => ({
		modelIdx: index("PortfolioSize_modelId_idx").on(table.modelId),
	}),
);

export const modelRelations = relations(models, ({ many }) => ({
	invocations: many(invocations),
	portfolioSnapshots: many(portfolioSize),
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

export type Model = typeof models.$inferSelect;
export type Invocation = typeof invocations.$inferSelect;
export type ToolCall = typeof toolCalls.$inferSelect;
export type PortfolioSnapshot = typeof portfolioSize.$inferSelect;

export const ToolCallType = {
	CREATE_POSITION: toolCallTypeEnum.enumValues[0],
	CLOSE_POSITION: toolCallTypeEnum.enumValues[1],
} as const;

export type ToolCallType = (typeof toolCallTypeEnum.enumValues)[number];
