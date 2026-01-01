import { SignerClient as LighterSignerClient } from "@reservoir0x/lighter-ts-sdk";
import path from "node:path";

// Get WASM path from the npm package
const wasmPath = path.join(
	process.cwd(),
	"node_modules/@reservoir0x/lighter-ts-sdk/wasm/lighter-signer.wasm",
);

export interface SignerClientConfig {
	url: string;
	privateKey: string;
	apiKeyIndex: number;
	accountIndex: number;
}

/**
 * Factory for creating SignerClient instances with the new @reservoir0x/lighter-ts-sdk.
 * Handles WASM initialization automatically.
 */
export class SignerClientFactory {
	/**
	 * Create and initialize a SignerClient instance.
	 * The client is fully initialized and ready to sign transactions.
	 */
	static async create(config: SignerClientConfig): Promise<LighterSignerClient> {
		const client = new LighterSignerClient({
			url: config.url,
			privateKey: config.privateKey,
			apiKeyIndex: config.apiKeyIndex,
			accountIndex: config.accountIndex,
			wasmConfig: { wasmPath },
		});

		await client.initialize();
		await client.ensureWasmClient();

		return client;
	}
}

// Re-export the SignerClient class for access to static constants
export { LighterSignerClient as SignerClient };
