import { randomUUID } from "node:crypto";

import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";

import { db } from "@/db";
import {
	type Invocation,
	invocations,
	type Model,
	models,
	type PortfolioSnapshot,
	portfolioSize,
	type ToolCall,
	ToolCallType,
	type ToolCallType as ToolCallTypeValue,
	toolCalls,
} from "@/db/schema";

type QueryableToolCall = {
	id: string;
	createdAt: Date;
	metadata: string;
	toolCallType: ToolCallTypeValue;
};

type QueryableToolCallWithModel = QueryableToolCall & {
	modelId: string;
	modelName: string;
	routerModel: string;
};

export async function createInvocationRecord(
	modelId: string,
): Promise<Invocation> {
	const [record] = await db
		.insert(invocations)
		.values({
			id: randomUUID(),
			modelId,
			response: "",
		})
		.returning();

	return record;
}

export async function createPortfolioSnapshot(
	modelId: string,
	netPortfolio: string,
): Promise<PortfolioSnapshot> {
	const [record] = await db
		.insert(portfolioSize)
		.values({
			id: randomUUID(),
			modelId,
			netPortfolio,
		})
		.returning();

	return record;
}

export async function createToolCallRecord(params: {
	invocationId: string;
	type: ToolCallTypeValue;
	metadata: string;
}): Promise<ToolCall> {
	const [record] = await db
		.insert(toolCalls)
		.values({
			id: randomUUID(),
			invocationId: params.invocationId,
			toolCallType: params.type,
			metadata: params.metadata,
		})
		.returning();

	return record;
}

export async function incrementModelUsage(
	modelId: string,
	deltas: { invocationCountDelta?: number; totalMinutesDelta?: number },
): Promise<void> {
	const updates: Record<string, unknown> = {};

	if (deltas.invocationCountDelta && deltas.invocationCountDelta !== 0) {
		updates.invocationCount = sql`${models.invocationCount} + ${deltas.invocationCountDelta}`;
	}

	if (deltas.totalMinutesDelta && deltas.totalMinutesDelta !== 0) {
		updates.totalMinutes = sql`${models.totalMinutes} + ${deltas.totalMinutesDelta}`;
	}

	if (Object.keys(updates).length === 0) {
		return;
	}

	await db.update(models).set(updates).where(eq(models.id, modelId));
}

export async function updateInvocationRecord(params: {
	id: string;
	response: string;
	responsePayload: unknown;
}): Promise<void> {
	await db
		.update(invocations)
		.set({
			response: params.response,
			responsePayload: params.responsePayload,
			updatedAt: new Date(),
		})
		.where(eq(invocations.id, params.id));
}

export async function listModels(): Promise<Model[]> {
	return db.select().from(models);
}

export async function listModelsOrderedAsc(): Promise<Model[]> {
	return db.select().from(models).orderBy(asc(models.name));
}

export async function getPortfolioHistory(
	modelId: string,
): Promise<PortfolioSnapshot[]> {
	return db
		.select()
		.from(portfolioSize)
		.where(eq(portfolioSize.modelId, modelId))
		.orderBy(asc(portfolioSize.createdAt));
}

export async function getRecentToolCallsForModel(params: {
	modelId: string;
	type: ToolCallTypeValue;
	limit?: number;
}): Promise<QueryableToolCall[]> {
	const limit = params.limit ?? 100;

	return db
		.select({
			id: toolCalls.id,
			createdAt: toolCalls.createdAt,
			metadata: toolCalls.metadata,
			toolCallType: toolCalls.toolCallType,
		})
		.from(toolCalls)
		.innerJoin(invocations, eq(toolCalls.invocationId, invocations.id))
		.where(
			and(
				eq(invocations.modelId, params.modelId),
				eq(toolCalls.toolCallType, params.type),
			),
		)
		.orderBy(desc(toolCalls.createdAt))
		.limit(limit);
}

export async function getRecentToolCallsWithModel(params: {
	type: ToolCallTypeValue;
	modelName?: string;
	limit?: number;
}): Promise<QueryableToolCallWithModel[]> {
	const limit = params.limit ?? 25;
	const filters = [eq(toolCalls.toolCallType, params.type)];

	if (params.modelName) {
		const pattern = `%${params.modelName}%`;
		filters.push(ilike(models.name, pattern));
	}

	return db
		.select({
			id: toolCalls.id,
			createdAt: toolCalls.createdAt,
			metadata: toolCalls.metadata,
			toolCallType: toolCalls.toolCallType,
			modelId: invocations.modelId,
			modelName: models.name,
			routerModel: models.openRouterModelName,
		})
		.from(toolCalls)
		.innerJoin(invocations, eq(toolCalls.invocationId, invocations.id))
		.innerJoin(models, eq(invocations.modelId, models.id))
		.where(and(...filters))
		.orderBy(desc(toolCalls.createdAt))
		.limit(limit);
}

export async function searchModels(params: {
	search?: string;
	limit?: number;
}): Promise<Model[]> {
	const limit = params.limit ?? 10;
	const pattern = params.search ? `%${params.search}%` : null;

	let query = db.select().from(models).orderBy(asc(models.name)).limit(limit);

	if (pattern) {
		query = query.where(
			or(
				ilike(models.name, pattern),
				ilike(models.openRouterModelName, pattern),
			),
		);
	}

	return query;
}

export async function fetchPortfolioSnapshots(params: {
	modelName?: string;
	limit?: number;
}): Promise<
	{
		snapshot: PortfolioSnapshot;
		model: Pick<Model, "name" | "openRouterModelName">;
	}[]
> {
	const limit = params.limit ?? 60;
	const pattern = params.modelName ? `%${params.modelName}%` : null;

	let query = db
		.select({
			snapshot: portfolioSize,
			modelName: models.name,
			routerModel: models.openRouterModelName,
		})
		.from(portfolioSize)
		.innerJoin(models, eq(portfolioSize.modelId, models.id))
		.orderBy(desc(portfolioSize.createdAt))
		.limit(limit);

	if (pattern) {
		query = query.where(ilike(models.name, pattern));
	}

	const rows = await query;

	return rows.map((row) => ({
		snapshot: {
			...row.snapshot,
		},
		model: {
			name: row.modelName,
			openRouterModelName: row.routerModel,
		},
	}));
}

export async function executeUnsafeQuery(sqlText: string): Promise<unknown[]> {
	const result = await db.execute(sql.raw(sqlText));
	return Array.isArray(result.rows) ? result.rows : [];
}

export { ToolCallType, type ToolCallTypeValue };
