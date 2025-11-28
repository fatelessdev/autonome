import { getInvocations, getModels } from "./models";
import {
	getAccount,
	getCompletedTradesFromDB,
	placeOrder,
	resetAccount,
} from "./simulator";
import {
	getCryptoPrices,
	getPortfolioHistory,
	getPositions,
	getTrades,
} from "./trading";

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

	// Simulator
	simulator: {
		placeOrder,
		getAccount,
		resetAccount,
		getCompletedTradesFromDB,
	},
};
