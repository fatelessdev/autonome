import { getFailures, getLeaderboard, getModelStats, getRunInfo } from "./analytics";
import { getInvocations, getModels } from "./models";
import {
	getCryptoPrices,
	getPortfolioHistory,
	getPositions,
	getTrades,
} from "./trading";
import {
	getVariants,
	getVariantStats,
	getVariantHistory,
} from "./variants";

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
	},

	// Variants (strategy configuration)
	variants: {
		getVariants,
		getVariantStats,
		getVariantHistory,
	},
};
