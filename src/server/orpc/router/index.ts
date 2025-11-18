import { getInvocations, getModels } from "./models";
import {
  getAccount,
  getCompletedTrades,
  getCompletedTradesFromDB,
  getOrderBook,
  placeOrder,
  resetAccount,
} from "./simulator";
import { addTodo, listTodos } from "./todos";
import {
  getCryptoPrices,
  getPortfolioHistory,
  getPositions,
  getTrades,
} from "./trading";

export default {
  // Demo/Example procedures
  listTodos,
  addTodo,

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
    getOrderBook,
    getCompletedTrades,
    getCompletedTradesFromDB,
  },
};
