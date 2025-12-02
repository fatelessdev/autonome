import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const cwd = process.cwd()
const bootstrapSourcePath = resolve(cwd, 'src/server/schedulers/bootstrap.ts')
const hasSourceBootstrap = existsSync(bootstrapSourcePath)

// In production, tsx/tsconfig-paths are only needed for source files
if (hasSourceBootstrap) {
	await import('tsx/esm')
	await import('tsconfig-paths/register.js')
}

const globalKey = '__autonomeSchedulersBootstrapped'

async function bootstrap() {
	if (globalThis[globalKey]) {
		return
	}

	globalThis[globalKey] = true

	try {
		const { bootstrapSchedulers } = await loadBootstrapModule()
		if (typeof bootstrapSchedulers === 'function') {
			await bootstrapSchedulers()
		}
	} catch (error) {
		console.error('[instrumentation] Failed to bootstrap schedulers', error)
	}
}

void bootstrap()

async function loadBootstrapModule() {
	// Try source file first (dev mode)
	if (hasSourceBootstrap) {
		return import(pathToFileURL(bootstrapSourcePath).href)
	}

	// In production, the bootstrap is bundled into the server - import from server chunks
	// The bootstrapSchedulers function should be called from the server entry instead
	console.log('[instrumentation] Running in production mode - schedulers should be initialized by server')
	return { bootstrapSchedulers: () => {} }
}

// import * as Sentry from '@sentry/tanstackstart-react'
// Sentry.init({
//   dsn: import.meta.env.VITE_SENTRY_DSN,
//   sendDefaultPii: true,
// })
