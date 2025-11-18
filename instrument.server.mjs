import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const bootstrapSourcePath = resolve(process.cwd(), 'src/server/schedulers/bootstrap.ts')
const hasSourceBootstrap = existsSync(bootstrapSourcePath)

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
	if (hasSourceBootstrap) {
		return import(pathToFileURL(bootstrapSourcePath).href)
	}

	throw new Error('Scheduler bootstrap module unavailable in current build output')
}

// import * as Sentry from '@sentry/tanstackstart-react'
// Sentry.init({
//   dsn: import.meta.env.VITE_SENTRY_DSN,
//   sendDefaultPii: true,
// })
