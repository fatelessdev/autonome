import type {
	TradingDecision,
	TradingDecisionResult,
} from "@/server/features/trading/tradingDecisions";

export type TradeSide = "LONG" | "SHORT" | "UNKNOWN";

export type Trade = {
	id: string;
	modelId: string;
	modelName: string;
	modelRouterName: string;
	modelKey: string;
	symbol: string;
	side: TradeSide;
	quantity: number | null;
	entryPrice: number | null;
	exitPrice: number | null;
	entryNotional: number | null;
	exitNotional: number | null;
	netPnl: number | null;
	openedAt: string | null;
	closedAt: string;
	holdingTime: string | null;
	timestamp: string | null;
};

export type PositionExitPlan = {
	target: number | null;
	stop: number | null;
	invalidation: string | null;
};

export type Position = {
	symbol: string;
	position: string;
	sign: "LONG" | "SHORT";
	quantity?: number | null;
	unrealizedPnl: string;
	realizedPnl: string;
	liquidationPrice: string;
	leverage?: number;
	notional?: string;
	exitPlan?: PositionExitPlan | null;
	confidence?: number | null;
	signal?: "LONG" | "SHORT" | "HOLD";
	lastDecisionAt?: string | null;
	decisionStatus?: string | null;
};

export type ModelPositions = {
	modelId: string;
	modelName: string;
	modelLogo: string;
	positions: Position[];
	totalUnrealizedPnl?: number;
	availableCash?: number;
};

export type Conversation = {
	id: string;
	modelId: string;
	modelName: string;
	modelLogo: string;
	response: string;
	timestamp: string;
	toolCalls: {
		id: string;
		type: string;
		metadata: {
			raw: unknown;
			decisions: TradingDecision[];
			results: TradingDecisionResult[];
		};
		timestamp: string;
	}[];
};

export type TradingDecisionCard = {
	key: string;
	symbol: string;
	signal: "LONG" | "SHORT" | "HOLD";
	action: "CREATE_POSITION" | "CLOSE_POSITION" | "UPDATE_EXIT_PLAN" | string;
	quantity: number | null;
	leverage: number | null;
	profitTarget: number | null;
	stopLoss: number | null;
	invalidationCondition: string | null;
	confidence: number | null;
	toolCallType: string;
	status?: string | null;
	result?: TradingDecisionResult | null;
	timestamp: string;
	reason?: string | null;
};

export type ModelOption = {
	id: string;
	label: string;
	logo: string;
	color: string;
};

export type TradingDashboardData = {
	trades: Trade[];
	positions: ModelPositions[];
	conversations: Conversation[];
	modelOptions: ModelOption[];
	loading: boolean;
};

export type ExitPlanSelection = {
	modelLabel: string;
	modelColor: string;
	position: Position;
};
