/**
 * Positions Repository
 *
 * Handles all database operations for positions including:
 * - Creating new positions when trades are opened
 * - Closing positions when trades are closed
 * - Fetching open positions for display
 * - Updating exit plans
 *
 * This replaces the in-memory simulator storage with persistent DB storage.
 */

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
	models,
	positions,
	type Position,
	type PositionSide,
} from "@/db/schema";

// ============================================================================
// Types
// ============================================================================

export interface CreatePositionParams {
	modelId: string;
	symbol: string;
	side: PositionSide;
	quantity: number;
	entryPrice: number;
	leverage?: number | null;
	confidence?: number | null;
	exitPlan?: {
		target: number | null;
		stop: number | null;
		invalidation: string | null;
	} | null;
	toolCallId?: string | null;
}

export interface UpdatePositionParams {
	quantity?: number;
	entryPrice?: number;
	leverage?: number | null;
	confidence?: number | null;
	exitPlan?: {
		target: number | null;
		stop: number | null;
		invalidation: string | null;
	} | null;
}

export interface PositionWithModel extends Position {
	model: {
		id: string;
		name: string;
		openRouterModelName: string;
	};
}

export interface ModelPositionsGroup {
	modelId: string;
	modelName: string;
	modelLogo: string;
	positions: Position[];
}

// ============================================================================
// Repository Functions
// ============================================================================

/**
 * Generate a unique position ID
 */
function generatePositionId(): string {
	return `pos_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Create a new position in the database
 */
export async function createPositionRecord(
	params: CreatePositionParams,
): Promise<Position> {
	const id = generatePositionId();

	const [position] = await db
		.insert(positions)
		.values({
			id,
			modelId: params.modelId,
			symbol: params.symbol.toUpperCase(),
			side: params.side,
			quantity: params.quantity.toString(),
			entryPrice: params.entryPrice.toString(),
			leverage: params.leverage?.toString() ?? null,
			confidence: params.confidence?.toString() ?? null,
			exitPlan: params.exitPlan ?? null,
			toolCallId: params.toolCallId ?? null,
		})
		.returning();

	return position;
}

/**
 * Upsert a position - create or update if exists for same model/symbol
 */
export async function upsertPosition(
	params: CreatePositionParams,
): Promise<Position> {
	const id = generatePositionId();
	const symbol = params.symbol.toUpperCase();

	const [position] = await db
		.insert(positions)
		.values({
			id,
			modelId: params.modelId,
			symbol,
			side: params.side,
			quantity: params.quantity.toString(),
			entryPrice: params.entryPrice.toString(),
			leverage: params.leverage?.toString() ?? null,
			confidence: params.confidence?.toString() ?? null,
			exitPlan: params.exitPlan ?? null,
			toolCallId: params.toolCallId ?? null,
		})
		.onConflictDoUpdate({
			target: [positions.modelId, positions.symbol],
			set: {
				side: params.side,
				quantity: params.quantity.toString(),
				entryPrice: params.entryPrice.toString(),
				leverage: params.leverage?.toString() ?? null,
				confidence: params.confidence?.toString() ?? null,
				exitPlan: params.exitPlan ?? null,
				toolCallId: params.toolCallId ?? null,
				updatedAt: new Date(),
			},
		})
		.returning();

	return position;
}

/**
 * Get a single position by model and symbol
 */
export async function getPositionBySymbol(
	modelId: string,
	symbol: string,
): Promise<Position | null> {
	const result = await db
		.select()
		.from(positions)
		.where(
			and(
				eq(positions.modelId, modelId),
				eq(positions.symbol, symbol.toUpperCase()),
			),
		)
		.limit(1);

	return result[0] ?? null;
}

/**
 * Get all open positions for a specific model
 */
export async function getPositionsByModel(modelId: string): Promise<Position[]> {
	return db
		.select()
		.from(positions)
		.where(eq(positions.modelId, modelId))
		.orderBy(positions.openedAt);
}

/**
 * Get all open positions grouped by model
 */
export async function getAllPositionsGrouped(): Promise<ModelPositionsGroup[]> {
	const allModels = await db
		.select({
			id: models.id,
			name: models.name,
			openRouterModelName: models.openRouterModelName,
		})
		.from(models);

	const allPositions = await db
		.select()
		.from(positions)
		.orderBy(positions.openedAt);

	// Group positions by model
	const positionsByModel = new Map<string, Position[]>();
	for (const position of allPositions) {
		const existing = positionsByModel.get(position.modelId) ?? [];
		existing.push(position);
		positionsByModel.set(position.modelId, existing);
	}

	// Build grouped result
	return allModels.map((model) => ({
		modelId: model.id,
		modelName: model.name,
		modelLogo: model.openRouterModelName,
		positions: positionsByModel.get(model.id) ?? [],
	}));
}

/**
 * Update an existing position
 */
export async function updatePosition(
	modelId: string,
	symbol: string,
	params: UpdatePositionParams,
): Promise<Position | null> {
	const updateData: Record<string, unknown> = {
		updatedAt: new Date(),
	};

	if (params.quantity !== undefined) {
		updateData.quantity = params.quantity.toString();
	}
	if (params.entryPrice !== undefined) {
		updateData.entryPrice = params.entryPrice.toString();
	}
	if (params.leverage !== undefined) {
		updateData.leverage = params.leverage?.toString() ?? null;
	}
	if (params.confidence !== undefined) {
		updateData.confidence = params.confidence?.toString() ?? null;
	}
	if (params.exitPlan !== undefined) {
		updateData.exitPlan = params.exitPlan;
	}

	const [updated] = await db
		.update(positions)
		.set(updateData)
		.where(
			and(
				eq(positions.modelId, modelId),
				eq(positions.symbol, symbol.toUpperCase()),
			),
		)
		.returning();

	return updated ?? null;
}

/**
 * Update exit plan for a position
 */
export async function updatePositionExitPlan(
	modelId: string,
	symbol: string,
	exitPlan: {
		target: number | null;
		stop: number | null;
		invalidation: string | null;
	},
): Promise<Position | null> {
	return updatePosition(modelId, symbol, { exitPlan });
}

/**
 * Close (delete) a position
 */
export async function closePositionRecord(
	modelId: string,
	symbol: string,
): Promise<Position | null> {
	const [deleted] = await db
		.delete(positions)
		.where(
			and(
				eq(positions.modelId, modelId),
				eq(positions.symbol, symbol.toUpperCase()),
			),
		)
		.returning();

	return deleted ?? null;
}

/**
 * Close multiple positions for a model
 */
export async function closePositionRecords(
	modelId: string,
	symbols: string[],
): Promise<Position[]> {
	const normalizedSymbols = symbols.map((s) => s.toUpperCase());
	const deleted: Position[] = [];

	// Delete one by one to collect all deleted records
	for (const symbol of normalizedSymbols) {
		const result = await closePositionRecord(modelId, symbol);
		if (result) {
			deleted.push(result);
		}
	}

	return deleted;
}

/**
 * Close all positions for a model (used when resetting account)
 */
export async function closeAllPositionsForModel(
	modelId: string,
): Promise<Position[]> {
	const deleted = await db
		.delete(positions)
		.where(eq(positions.modelId, modelId))
		.returning();

	return deleted;
}
