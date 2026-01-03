/**
 * TAAPI Integration
 * Technical Analysis API integration for supplementary indicators
 */

export { taapiClient, TaapiClient } from "./client";
export { taapiCache } from "./cache";
export type {
	TaapiIndicatorConfig,
	TaapiBulkPayload,
	TaapiBulkResponse,
	TaapiBulkResponseItem,
	TaapiPreFetchResult,
	TaapiConstruct,
	BBandsResult,
	ADXResult,
	SupertrendResult,
	StochRSIResult,
	IchimokuResult,
	MACDResult,
	KeltnerResult,
	DonchianResult,
	VWAPResult,
	OBVResult,
	CCIResult,
	WillRResult,
	MFIResult,
	SARResult,
	StochResult,
	TaapiIndicatorName,
} from "./types";
export { AVAILABLE_TAAPI_INDICATORS, TAAPI_FREE_PLAN_SYMBOLS } from "./types";
