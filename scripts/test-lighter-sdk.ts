/**
 * Test script to verify @reservoir0x/lighter-ts-sdk works correctly
 * Run with: bun run scripts/test-lighter-sdk.ts
 */

import {
	ApiClient,
	CandlestickApi,
	OrderApi,
	AccountApi,
	SignerClient,
} from "@reservoir0x/lighter-ts-sdk";
import path from "node:path";

const BASE_URL = "https://mainnet.zklighter.elliot.ai";

async function testSDK() {
	console.log("=".repeat(60));
	console.log("Testing @reservoir0x/lighter-ts-sdk");
	console.log("=".repeat(60));
	console.log();

	// 1. Test API client connection
	console.log("1. Testing ApiClient connection...");
	const apiClient = new ApiClient({ host: BASE_URL });
	console.log("   ApiClient created successfully");
	console.log();

	// 2. Test CandlestickApi (public endpoint)
	console.log("2. Testing CandlestickApi...");
	try {
		const candlestickApi = new CandlestickApi(apiClient);
		const candles = await candlestickApi.getCandlesticks({
			market_id: 0, // ETH market
			resolution: "1m",
			count_back: 5,
		});

		// Log the response structure
		console.log("   Response structure:", Object.keys(candles));
		console.log(
			"   Candlesticks received:",
			candles.candlesticks?.length || 0
		);

		if (candles.candlesticks && candles.candlesticks.length > 0) {
			const latest = candles.candlesticks[candles.candlesticks.length - 1];
			console.log("   Latest candle:", {
				open: latest.open,
				high: latest.high,
				low: latest.low,
				close: latest.close,
			});
		}
		console.log("   CandlestickApi: PASSED");
	} catch (error) {
		console.error(
			"   CandlestickApi: FAILED",
			error instanceof Error ? error.message : error
		);
	}
	console.log();

	// 3. Test OrderApi (public endpoint)
	console.log("3. Testing OrderApi...");
	try {
		const orderApi = new OrderApi(apiClient);
		const orderBook = await orderApi.getOrderBookDetails({ market_id: 0 });

		// Log the response structure
		console.log("   Response structure:", Object.keys(orderBook));
		console.log("   Bids:", orderBook.bids?.length || 0, "levels");
		console.log("   Asks:", orderBook.asks?.length || 0, "levels");

		if (orderBook.bids && orderBook.bids.length > 0) {
			console.log("   Best bid:", orderBook.bids[0]);
		}
		console.log("   OrderApi: PASSED");
	} catch (error) {
		console.error(
			"   OrderApi: FAILED",
			error instanceof Error ? error.message : error
		);
	}
	console.log();

	// 4. Test CandlestickApi.getFundings (historical funding data)
	console.log("4. Testing CandlestickApi.getFundings...");
	try {
		const candlestickApiForFunding = new CandlestickApi(apiClient);
		const funding = await candlestickApiForFunding.getFundings({
			market_id: 0,
			resolution: "1h",
			count_back: 5,
		});

		console.log("   Response structure:", Object.keys(funding));
		console.log("   Fundings received:", funding.fundings?.length || 0);
		console.log("   CandlestickApi.getFundings: PASSED");
	} catch (error) {
		console.error(
			"   CandlestickApi.getFundings: FAILED",
			error instanceof Error ? error.message : error
		);
	}
	console.log();

	// 5. Test AccountApi (public endpoint)
	console.log("5. Testing AccountApi...");
	try {
		const accountApi = new AccountApi(apiClient);
		// Use a known account index from the examples (309677 from the old SDK examples)
		const account = await accountApi.getAccount({
			by: "index",
			value: "309677",
		});

		// Log the response structure to understand it
		console.log("   Response structure:", Object.keys(account));
		console.log("   Response type:", typeof account);

		// Check if it's wrapped in 'accounts' array
		const actualAccount = (account as any).accounts?.[0] || account;
		console.log("   Account index:", actualAccount.index);
		console.log("   Positions count:", actualAccount.positions?.length || 0);
		console.log("   AccountApi: PASSED");
	} catch (error) {
		console.error(
			"   AccountApi: FAILED",
			error instanceof Error ? error.message : error
		);
	}
	console.log();

	// 6. Test SignerClient static constants
	console.log("6. Testing SignerClient constants...");
	try {
		console.log("   ORDER_TYPE_LIMIT:", SignerClient.ORDER_TYPE_LIMIT);
		console.log("   ORDER_TYPE_MARKET:", SignerClient.ORDER_TYPE_MARKET);
		console.log(
			"   ORDER_TIME_IN_FORCE_IMMEDIATE_OR_CANCEL:",
			SignerClient.ORDER_TIME_IN_FORCE_IMMEDIATE_OR_CANCEL
		);
		console.log(
			"   ORDER_TIME_IN_FORCE_GOOD_TILL_TIME:",
			SignerClient.ORDER_TIME_IN_FORCE_GOOD_TILL_TIME
		);
		console.log("   NIL_TRIGGER_PRICE:", SignerClient.NIL_TRIGGER_PRICE);
		console.log("   DEFAULT_IOC_EXPIRY:", SignerClient.DEFAULT_IOC_EXPIRY);
		console.log("   SignerClient constants: PASSED");
	} catch (error) {
		console.error(
			"   SignerClient constants: FAILED",
			error instanceof Error ? error.message : error
		);
	}
	console.log();

	// 7. Test SignerClient initialization (without actually signing)
	console.log("7. Testing SignerClient initialization...");
	try {
		const wasmPath = path.join(
			process.cwd(),
			"node_modules/@reservoir0x/lighter-ts-sdk/wasm/lighter-signer.wasm"
		);
		console.log("   WASM path:", wasmPath);

		// Use a dummy private key for testing (won't actually sign anything)
		const dummyPrivateKey =
			"0x0000000000000000000000000000000000000000000000000000000000000001";

		const signerClient = new SignerClient({
			url: BASE_URL,
			privateKey: dummyPrivateKey,
			accountIndex: 0,
			apiKeyIndex: 0,
			wasmConfig: { wasmPath },
		});
		console.log("   SignerClient created");

		await signerClient.initialize();
		console.log("   SignerClient initialized");

		await signerClient.ensureWasmClient();
		console.log("   WASM client ready");

		await signerClient.close();
		console.log("   SignerClient closed");
		console.log("   SignerClient initialization: PASSED");
	} catch (error) {
		console.error(
			"   SignerClient initialization: FAILED",
			error instanceof Error ? error.message : error
		);
	}
	console.log();

	// Cleanup
	await apiClient.close();

	console.log("=".repeat(60));
	console.log("All tests completed!");
	console.log("=".repeat(60));
}

testSDK().catch(console.error);
