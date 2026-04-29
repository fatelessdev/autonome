import { File } from "node:buffer";

// Polyfill globalThis.File for environments missing it (e.g. Node 18 / Stackblitz)
if (typeof globalThis.File === "undefined") {
	globalThis.File = File as typeof globalThis.File;
}
