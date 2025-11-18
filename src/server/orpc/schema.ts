import { z } from "zod";

// ==================== Common Schemas ====================

export const TodoSchema = z.object({
  id: z.number().int().min(1),
  name: z.string(),
});

// ==================== Trading Schemas ====================

export const TradeSchema = z.object({
  id: z.string(),
  modelId: z.string(),
  modelName: z.string(),
  modelRouterName: z.string().optional(),
  modelKey: z.string().optional(),
  side: z.enum(["long", "short"]),
  symbol: z.string(),
  entryPrice: z.number(),
  exitPrice: z.number(),
  quantity: z.number(),
  entryNotional: z.number(),
  exitNotional: z.number(),
  netPnl: z.number(),
  openedAt: z.string(),
  closedAt: z.string(),
  holdingTime: z.string().optional(),
  timestamp: z.string(),
});

export const TradesResponseSchema = z.object({
  trades: z.array(TradeSchema),
});

// ==================== Position Schemas ====================

export const ExitPlanSchema = z.object({
  target: z.number().optional(),
  stop: z.number().optional(),
  invalidation: z
    .object({
      enabled: z.boolean(),
      message: z.string().optional(),
    })
    .optional(),
});

export const PositionSchema = z.object({
  symbol: z.string(),
  side: z.enum(["long", "short"]),
  quantity: z.number(),
  entryPrice: z.number(),
  currentPrice: z.number().optional(),
  unrealizedPnl: z.number().optional(),
  exitPlan: ExitPlanSchema.optional(),
  signal: z.string().optional(),
  leverage: z.number().optional(),
  confidence: z.number().optional(),
  lastDecisionAt: z.string().optional(),
  decisionStatus: z.string().optional(),
});

export const AccountPositionsSchema = z.object({
  modelId: z.string(),
  modelName: z.string(),
  modelLogo: z.string().optional(),
  positions: z.array(PositionSchema),
  totalUnrealizedPnl: z.number().optional(),
  availableCash: z.number().optional(),
});

export const PositionsResponseSchema = z.object({
  positions: z.array(AccountPositionsSchema),
});

// ==================== Crypto Price Schemas ====================

export const CryptoPriceSchema = z.object({
  symbol: z.string(),
  price: z.number(),
  message: z.string().optional(),
});

export const CryptoPricesInputSchema = z.object({
  symbols: z.array(z.string()).optional(),
});

export const CryptoPricesResponseSchema = z.object({
  prices: z.array(CryptoPriceSchema),
});

// ==================== Portfolio History Schemas ====================

export const PortfolioSnapshotSchema = z.object({
  id: z.string(),
  modelId: z.string(),
  netPortfolio: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  model: z
    .object({
      name: z.string(),
      openRouterModelName: z.string().optional(),
    })
    .optional(),
});

export const PortfolioHistoryResponseSchema = z.array(PortfolioSnapshotSchema);

// ==================== Models Schemas ====================

export const ModelSchema = z.object({
  id: z.string(),
  name: z.string(),
});

export const ModelsResponseSchema = z.object({
  models: z.array(ModelSchema),
  warning: z.string().optional(),
});

// ==================== Invocations Schemas ====================

export const InvocationSchema = z.object({
  id: z.string(),
  modelId: z.string(),
  modelName: z.string(),
  modelLogo: z.string(),
  response: z.string().nullable(),
  responsePayload: z.any().optional(),
  timestamp: z.string(),
  toolCalls: z.array(z.object({
    id: z.string(),
    type: z.string(),
    metadata: z.object({
      raw: z.any(),
      decisions: z.array(z.any()),
      results: z.array(z.any()),
    }),
    timestamp: z.string(),
  })),
});

export const InvocationsResponseSchema = z.object({
  conversations: z.array(InvocationSchema),
});

// ==================== Simulator Schemas ====================

export const SimulatorResetInputSchema = z.object({
  accountId: z.string(),
});

export const SimulatorResetResponseSchema = z.object({
  success: z.boolean(),
  message: z.string().optional(),
});
