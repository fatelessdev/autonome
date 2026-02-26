/**
 * Alpaca News Integration
 * Fetches recent news articles from Alpaca's News API for trading context.
 */

export { getSharedNewsDigest, invalidateNewsCache } from "./client";
export type { NewsDigestItem, AlpacaNewsArticle, AlpacaNewsResponse } from "./types";
