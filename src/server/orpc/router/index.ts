import {
	getFailures,
	getLeaderboard,
	getModelStats,
	getRunInfo,
} from "./analytics";
import { getDecisionDiary, getMarketState } from "./diary";
import { getHealth, getSchedulerHealth } from "./health";
import { getInvocations, getModels } from "./models";
import {
	getCryptoPrices,
	getPortfolioHistory,
	getPositions,
	getTrades,
} from "./trading";
import { getVariantHistory, getVariantStats, getVariants } from "./variants";

export default {
	// Trading procedures
	trading: {
		getTrades,
		getPositions,
		getCryptoPrices,
		getPortfolioHistory,
	},

	// Models & Invocations
	models: {
		getModels,
		getInvocations,
	},

	// Analytics
	analytics: {
		getModelStats,
		getLeaderboard,
		getFailures,
		getRunInfo,
		getDecisionDiary,
		getMarketState,
	},

	// Variants (strategy configuration)
	variants: {
		getVariants,
		getVariantStats,
		getVariantHistory,
	},

	// System health
	health: {
		getHealth,
		getSchedulerHealth,
	},
};
