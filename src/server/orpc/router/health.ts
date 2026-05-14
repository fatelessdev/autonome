import "@/polyfill";

import { os } from "@orpc/server";
import { z } from "zod";

import { DetailedHealthResponseSchema, HealthResponseSchema } from "../schema";

const serverStartedAt = new Date();

function getUptimeSeconds(): number {
	return Math.floor((Date.now() - serverStartedAt.getTime()) / 1000);
}

function baseHealthFields() {
	return {
		timestamp: new Date().toISOString(),
		serverStartedAt: serverStartedAt.toISOString(),
		uptimeSeconds: getUptimeSeconds(),
	};
}

export const getHealth = os
	.input(z.object({}))
	.output(HealthResponseSchema)
	.handler(async () => {
		return {
			status: "ok",
			...baseHealthFields(),
			schedulers: {
				trade: {
					healthy: true,
					lastRun: null,
					ageMs: null,
				},
				portfolio: {
					healthy: true,
					lastRun: null,
					ageMs: null,
				},
			},
		};
	});

export const getSchedulerHealth = os
	.input(z.object({}))
	.output(DetailedHealthResponseSchema)
	.handler(async () => {
		return {
			...baseHealthFields(),
			tradeScheduler: {
				lastRun: null,
				ageSeconds: null,
				modelsCurrentlyRunning: [],
				workflowManaged: true,
				lastSuccessfulCompletion: null,
				lastSuccessAge: null,
				lastCycleStats: null,
				consecutiveFailedCycles: 0,
			},
			portfolioScheduler: {
				lastRun: null,
				ageSeconds: null,
				workflowManaged: true,
				initialized: true,
			},
		};
	});
