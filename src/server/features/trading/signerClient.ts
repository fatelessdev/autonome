const isBunRuntime = typeof globalThis !== "undefined" && "Bun" in globalThis;

const signerModulePromise = isBunRuntime
	? import("../../../../lighter-sdk-ts/signer")
	: import("../../../../lighter-sdk-ts/signer-stub");

const signerModule = await signerModulePromise;

export const { SignerClient } = signerModule;
