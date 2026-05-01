import { randomUUID } from "node:crypto";

import {
	and,
	asc,
	desc,
	eq,
	gte,
	ilike,
	inArray,
	lt,
	or,
	sql,
} from "drizzle-orm";

import { db } from "@/db";
import {
	type DecisionDiaryEntry,
	decisionDiary,
	type Invocation,
	invocations,
	type MarketStateEntry,
	type Model,
	marketState,
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
	deltas: {
		invocationCountDelta?: number;
		totalMinutesDelta?: number;
		failedWorkflowCountDelta?: number;
		failedToolCallCountDelta?: number;
	},
): Promise<void> {
	const updates: Record<string, unknown> = {};

	if (deltas.invocationCountDelta) {
		updates.invocationCount = sql`${models.invocationCount} + ${deltas.invocationCountDelta}`;
	}

	if (deltas.totalMinutesDelta) {
		updates.totalMinutes = sql`${models.totalMinutes} + ${deltas.totalMinutesDelta}`;
	}

	if (deltas.failedWorkflowCountDelta) {
		updates.failedWorkflowCount = sql`${models.failedWorkflowCount} + ${deltas.failedWorkflowCountDelta}`;
	}

	if (deltas.failedToolCallCountDelta) {
		updates.failedToolCallCount = sql`${models.failedToolCallCount} + ${deltas.failedToolCallCountDelta}`;
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

export function listModels(): Promise<Model[]> {
	return db.select().from(models);
}

export function listModelsOrderedAsc(): Promise<Model[]> {
	return db.select().from(models).orderBy(asc(models.name));
}

export function getPortfolioHistory(
	modelId: string,
): Promise<PortfolioSnapshot[]> {
	return db
		.select()
		.from(portfolioSize)
		.where(eq(portfolioSize.modelId, modelId))
		.orderBy(asc(portfolioSize.createdAt));
}

export function getRecentToolCallsForModel(params: {
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

export function getRecentToolCallsWithModel(params: {
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

export function searchModels(params: {
	search?: string;
	limit?: number;
}): Promise<Model[]> {
	const limit = params.limit ?? 10;
	const pattern = params.search ? `%${params.search}%` : null;

	if (pattern) {
		return db
			.select()
			.from(models)
			.where(
				or(
					ilike(models.name, pattern),
					ilike(models.openRouterModelName, pattern),
				),
			)
			.orderBy(asc(models.name))
			.limit(limit);
	}

	return db.select().from(models).orderBy(asc(models.name)).limit(limit);
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

	const rows = await db
		.select({
			snapshot: portfolioSize,
			modelName: models.name,
			routerModel: models.openRouterModelName,
		})
		.from(portfolioSize)
		.innerJoin(models, eq(portfolioSize.modelId, models.id))
		.where(pattern ? ilike(models.name, pattern) : undefined)
		.orderBy(desc(portfolioSize.createdAt))
		.limit(limit);

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

// ==========================================
// DecisionDiary & MarketState Writes
// ==========================================

export async function createDecisionDiaryEntry(params: {
	modelId: string;
	invocationId: string;
	variant: "Trendsurfer" | "Contrarian" | "Sovereign";
	decisions: Array<{
		symbol: string;
		side: "LONG" | "SHORT" | "HOLD";
		confidence: number | null;
		reasoningSummary: string | null;
	}>;
	marketSnapshot: {
		adx: number | null;
		regime: "trending" | "ranging" | "choppy" | null;
		bbandsPosition: "upper" | "middle" | "lower" | null;
		supertrendDirection: "long" | "short" | null;
	};
	modelState: {
		cash: number;
		exposurePct: number;
		portfolioValue: number;
		openPositionsCount: number;
	};
}): Promise<DecisionDiaryEntry> {
	const [record] = await db
		.insert(decisionDiary)
		.values({
			id: randomUUID(),
			modelId: params.modelId,
			invocationId: params.invocationId,
			variant: params.variant,
			decisions: params.decisions,
			marketSnapshot: params.marketSnapshot,
			modelState: params.modelState,
		})
		.returning();

	return record;
}

export async function createMarketStateEntry(params: {
	modelId: string;
	regime: string | null;
	adxValue: string | null;
	topMovers: Array<{ symbol: string; changePct: number }>;
	activeCorrelations: Array<{
		symbolA: string;
		symbolB: string;
		correlation: number;
	}>;
	openInterestSummary: Array<{
		symbol: string;
		openInterest: number;
		openInterestValueUsd: number;
		changePercent: number;
	}> | null;
}): Promise<MarketStateEntry> {
	const [record] = await db
		.insert(marketState)
		.values({
			id: randomUUID(),
			modelId: params.modelId,
			regime: params.regime,
			adxValue: params.adxValue,
			topMovers: params.topMovers,
			activeCorrelations: params.activeCorrelations,
			openInterestSummary: params.openInterestSummary,
		})
		.returning();

	return record;
}

export async function pruneDecisionDiary(cutoffDate: Date): Promise<number> {
	const result = await db
		.delete(decisionDiary)
		.where(sql`${decisionDiary.createdAt} < ${cutoffDate}`)
		.returning({ id: decisionDiary.id });

	return result.length;
}

export async function pruneMarketState(cutoffDate: Date): Promise<number> {
	const result = await db
		.delete(marketState)
		.where(sql`${marketState.recordedAt} < ${cutoffDate}`)
		.returning({ id: marketState.id });

	return result.length;
}

// ==========================================
// DecisionDiary & MarketState Reads
// ==========================================

// ==========================================
// Composite cursor helpers
//
// Cursor format: "{createdAt_iso}::{id}"
// This ensures correct pagination ordering when used with ORDER BY (createdAt DESC, id DESC).
// UUID v4 IDs are not lexicographically time-ordered, so we pair them with createdAt.
// ==========================================

export function encodeCursor(createdAt: Date, id: string): string {
	return `${createdAt.toISOString()}::${id}`;
}

export function decodeCursor(
	cursor: string,
): { createdAt: Date; id: string } | null {
	const sep = cursor.indexOf("::");
	if (sep === -1) return null;
	const isoPart = cursor.slice(0, sep);
	const idPart = cursor.slice(sep + 2);
	const date = new Date(isoPart);
	if (Number.isNaN(date.getTime())) return null;
	return { createdAt: date, id: idPart };
}

export interface DecisionDiaryQueryFilters {
	variant?: string;
	symbol?: string;
	dateFrom?: Date;
	dateTo?: Date;
	modelId?: string;
	limit?: number;
	cursor?: string;
}

export interface DecisionDiaryWithMarketState extends DecisionDiaryEntry {
	nearestMarketState?: MarketStateEntry | null;
}

/**
 * Query DecisionDiary entries with optional filters.
 *
 * - variant: exact match on variant column
 * - symbol: filters entries where the `decisions` jsonb array contains an object with that symbol
 * - dateFrom/dateTo: range filter on createdAt (dateFrom is INCLUSIVE)
 * - modelId: exact match
 * - limit/cursor: pagination using composite (createdAt, id) cursor
 * - includeMarketState: when true, batch-fetches nearest prior MarketState for each modelId
 *
 * Cursor is a composite "{createdAt_iso}::{id}" string — not a raw UUID.
 * This avoids silent data loss when paginating with random UUID v4 IDs.
 */
export async function queryDecisionDiary(
	filters: DecisionDiaryQueryFilters & { includeMarketState?: boolean },
): Promise<DecisionDiaryWithMarketState[]> {
	const {
		variant,
		symbol,
		dateFrom,
		dateTo,
		modelId,
		limit,
		cursor,
		includeMarketState,
	} = filters;
	const pageSize = Math.min(limit ?? 50, 100);

	const conditions = [];

	if (variant) {
		conditions.push(
			eq(
				decisionDiary.variant,
				variant as "Trendsurfer" | "Contrarian" | "Sovereign",
			),
		);
	}

	if (modelId) {
		conditions.push(eq(decisionDiary.modelId, modelId));
	}

	if (dateFrom) {
		conditions.push(gte(decisionDiary.createdAt, dateFrom));
	}

	if (dateTo) {
		conditions.push(lt(decisionDiary.createdAt, dateTo));
	}

	if (symbol) {
		// Filter entries where the decisions jsonb array contains an element with the given symbol
		conditions.push(
			sql`EXISTS (SELECT 1 FROM jsonb_array_elements(${decisionDiary.decisions}) AS d WHERE d->>'symbol' = ${symbol})`,
		);
	}

	if (cursor) {
		const decoded = decodeCursor(cursor);
		if (decoded) {
			// Composite cursor: (createdAt, id) < (cursor.createdAt, cursor.id) in DESC order
			// i.e. createdAt < cursor.createdAt OR (createdAt = cursor.createdAt AND id < cursor.id)
			conditions.push(
				or(
					lt(decisionDiary.createdAt, decoded.createdAt),
					and(
						eq(decisionDiary.createdAt, decoded.createdAt),
						lt(decisionDiary.id, decoded.id),
					),
				),
			);
		}
	}

	const where = conditions.length > 0 ? and(...conditions) : undefined;

	const rows = await db
		.select()
		.from(decisionDiary)
		.where(where)
		.orderBy(desc(decisionDiary.createdAt), desc(decisionDiary.id))
		.limit(pageSize);

	if (!includeMarketState || rows.length === 0) {
		return rows;
	}

	// Batch temporal join: collect unique modelIds, fetch recent MarketState
	// records in one query, then join in memory.
	const uniqueModelIds = [...new Set(rows.map((r) => r.modelId))];

	const firstCreatedAt = rows[0]?.createdAt;
	if (!firstCreatedAt) return rows;

	const earliestCreatedAt = rows.reduce(
		(min, r) => (r.createdAt < min ? r.createdAt : min),
		firstCreatedAt,
	);

	// Fetch all MarketState records that could be "nearest prior" for any diary entry.
	// We need records for each modelId that are older than the latest diary entry's createdAt.
	const latestCreatedAt = rows.reduce(
		(max, r) => (r.createdAt > max ? r.createdAt : max),
		firstCreatedAt,
	);

	const marketStateRows = await db
		.select()
		.from(marketState)
		.where(
			and(
				inArray(marketState.modelId, uniqueModelIds),
				lt(marketState.recordedAt, latestCreatedAt),
				// Only fetch records that could be relevant (within a reasonable window)
				gte(marketState.recordedAt, earliestCreatedAt),
			),
		)
		.orderBy(desc(marketState.recordedAt));

	// Build lookup: for each modelId, sorted by recordedAt DESC
	const marketStateByModel = new Map<string, MarketStateEntry[]>();
	for (const ms of marketStateRows) {
		const list = marketStateByModel.get(ms.modelId);
		if (list) {
			list.push(ms);
		} else {
			marketStateByModel.set(ms.modelId, [ms]);
		}
	}

	// Join in memory: for each diary entry, find the nearest prior MarketState
	const entriesWithMarketState: DecisionDiaryWithMarketState[] = rows.map(
		(row) => {
			const candidates = marketStateByModel.get(row.modelId);
			if (!candidates) {
				return { ...row, nearestMarketState: null };
			}
			// candidates are sorted DESC by recordedAt — find the first one before row.createdAt
			const nearest =
				candidates.find((ms) => ms.recordedAt < row.createdAt) ?? null;
			return { ...row, nearestMarketState: nearest };
		},
	);

	return entriesWithMarketState;
}

export interface MarketStateQueryFilters {
	modelId?: string;
	dateFrom?: Date;
	dateTo?: Date;
	regime?: string;
	limit?: number;
	cursor?: string;
}

/**
 * Query MarketState entries with optional filters.
 *
 * dateFrom is INCLUSIVE. Cursor uses composite (recordedAt, id) to avoid
 * silent data loss from UUID v4 ordering.
 */
export async function queryMarketState(
	filters: MarketStateQueryFilters,
): Promise<MarketStateEntry[]> {
	const { modelId, dateFrom, dateTo, regime, limit, cursor } = filters;
	const pageSize = Math.min(limit ?? 50, 100);

	const conditions = [];

	if (modelId) {
		conditions.push(eq(marketState.modelId, modelId));
	}

	if (dateFrom) {
		conditions.push(gte(marketState.recordedAt, dateFrom));
	}

	if (dateTo) {
		conditions.push(lt(marketState.recordedAt, dateTo));
	}

	if (regime) {
		conditions.push(eq(marketState.regime, regime));
	}

	if (cursor) {
		const decoded = decodeCursor(cursor);
		if (decoded) {
			conditions.push(
				or(
					lt(marketState.recordedAt, decoded.createdAt),
					and(
						eq(marketState.recordedAt, decoded.createdAt),
						lt(marketState.id, decoded.id),
					),
				),
			);
		}
	}

	const where = conditions.length > 0 ? and(...conditions) : undefined;

	return db
		.select()
		.from(marketState)
		.where(where)
		.orderBy(desc(marketState.recordedAt), desc(marketState.id))
		.limit(pageSize);
}

export { ToolCallType, type ToolCallTypeValue };
