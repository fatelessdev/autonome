// Stub file for Next.js build - the actual implementation uses Bun FFI
// This file should never be used at runtime

import {
    NonceManager,
    NonceManagerType,
} from './nonce_manager';
import { SignResult, type CreateOrderParams, TxResponse } from './types';
import { SignerError } from './errors';
import { RespSendTx } from './generated';

export const CODE_OK = 200;

export interface SignerClientOptions {
    url: string;
    privateKey: string;
    apiKeyIndex: number;
    accountIndex: number;
    maxApiKeyIndex?: number;
    privateKeys?: Record<number, string>;
    nonceManagementType?: NonceManagerType;
}

export class SignerClient {
    // Constants
    static readonly USDC_TICKER_SCALE = 1e6;
    static readonly TX_TYPE_CHANGE_PUB_KEY = 8;
    static readonly TX_TYPE_CREATE_SUB_ACCOUNT = 9;
    static readonly TX_TYPE_CREATE_PUBLIC_POOL = 10;
    static readonly TX_TYPE_UPDATE_PUBLIC_POOL = 11;
    static readonly TX_TYPE_TRANSFER = 12;
    static readonly TX_TYPE_WITHDRAW = 13;
    static readonly TX_TYPE_CREATE_ORDER = 14;
    static readonly TX_TYPE_CANCEL_ORDER = 15;
    static readonly TX_TYPE_CANCEL_ALL_ORDERS = 16;
    static readonly TX_TYPE_MODIFY_ORDER = 17;
    static readonly TX_TYPE_MINT_SHARES = 18;
    static readonly TX_TYPE_BURN_SHARES = 19;
    static readonly TX_TYPE_UPDATE_LEVERAGE = 20;
    static readonly ORDER_TYPE_LIMIT = 0;
    static readonly ORDER_TYPE_MARKET = 1;
    static readonly ORDER_TYPE_STOP_LOSS = 2;
    static readonly ORDER_TYPE_STOP_LOSS_LIMIT = 3;
    static readonly ORDER_TYPE_TAKE_PROFIT = 4;
    static readonly ORDER_TYPE_TAKE_PROFIT_LIMIT = 5;
    static readonly ORDER_TYPE_TWAP = 6;
    static readonly ORDER_TIME_IN_FORCE_IMMEDIATE_OR_CANCEL = 0;
    static readonly ORDER_TIME_IN_FORCE_GOOD_TILL_TIME = 1;
    static readonly ORDER_TIME_IN_FORCE_POST_ONLY = 2;
    static readonly CANCEL_ALL_TIF_IMMEDIATE = 0;
    static readonly CANCEL_ALL_TIF_SCHEDULED = 1;
    static readonly CANCEL_ALL_TIF_ABORT = 2;
    static readonly NIL_TRIGGER_PRICE = 0;
    static readonly DEFAULT_28_DAY_ORDER_EXPIRY = -1;
    static readonly DEFAULT_IOC_EXPIRY = 0;
    static readonly DEFAULT_10_MIN_AUTH_EXPIRY = -1;
    static readonly MINUTE = 60;
    static readonly CROSS_MARGIN_MODE = 0;
    static readonly ISOLATED_MARGIN_MODE = 1;

    private constructor() {
        throw new SignerError('SignerClient stub should not be instantiated');
    }

    static async create(options: SignerClientOptions): Promise<SignerClient> {
        throw new SignerError('SignerClient stub cannot be created - this should only run with Bun runtime');
    }

    async createOrder(params: CreateOrderParams): Promise<TxResponse> {
        throw new SignerError('SignerClient stub cannot create orders');
    }

    async cancelOrder(marketIndex: number, clientOrderIndex: number): Promise<TxResponse> {
        throw new SignerError('SignerClient stub cannot cancel orders');
    }

    async sendTx(tx_type: number, tx_info: string): Promise<RespSendTx> {
        throw new SignerError('SignerClient stub cannot send transactions');
    }

    signCreateOrder(...args: any[]): SignResult {
        throw new SignerError('SignerClient stub cannot sign orders');
    }

    signCancelAllOrders(...args: any[]): SignResult {
        throw new SignerError('SignerClient stub cannot sign cancel all orders');
    }

    signCancelOrder(...args: any[]): SignResult {
        throw new SignerError('SignerClient stub cannot sign cancel orders');
    }

    getNonceManager(): NonceManager | undefined {
        return undefined;
    }
}
