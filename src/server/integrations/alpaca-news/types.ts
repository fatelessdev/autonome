/**
 * Alpaca News API Types
 *
 * Types for the /v1beta1/news endpoint.
 * Docs: https://docs.alpaca.markets/reference/news-1
 */

export interface AlpacaNewsArticle {
	id: number;
	headline: string;
	author: string;
	created_at: string;
	updated_at: string;
	summary: string;
	content: string | null;
	url: string;
	source: string;
	symbols: string[];
	images: Array<{ size: string; url: string }>;
}

export interface AlpacaNewsResponse {
	news: AlpacaNewsArticle[];
	next_page_token: string | null;
}

export interface NewsDigestItem {
	headline: string;
	summary: string;
	source: string;
	symbols: string[];
	publishedAt: string;
}
