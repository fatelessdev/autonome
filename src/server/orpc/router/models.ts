import "@/polyfill";

import { os } from "@orpc/server";
import * as Sentry from "@sentry/react";
import { z } from "zod";

import {
	refreshConversationEvents,
} from "@/server/features/trading/conversationsSnapshot.server";
import {
	fetchModelsList,
} from "@/server/features/trading/queries.server";
import { MODEL_INFO } from "@/shared/models/modelConfig";
import { InvocationsResponseSchema, ModelsResponseSchema } from "../schema";

// ==================== Models ====================

export const getModels = os
	.input(z.object({}))
	.output(ModelsResponseSchema)
	.handler(async () => {
		return Sentry.startSpan({ name: "getModels" }, async () => {
			try {
				const models = await fetchModelsList();
				return { models };
			} catch (error) {
				console.error("Failed to fetch models", error);
				Sentry.captureException(error);

				const fallback = Object.entries(MODEL_INFO).map(([id, info]) => ({
					id,
					name: info.label || id,
				}));

				return {
					models: fallback,
					warning: "Database unavailable, using static model metadata.",
				};
			}
		});
	});

// ==================== Invocations ====================

export const getInvocations = os
	.input(z.object({}))
	.output(InvocationsResponseSchema)
	.handler(async () => {
		return Sentry.startSpan({ name: "getInvocations" }, async () => {
			try {
				const conversations = await refreshConversationEvents();
				return { conversations };
			} catch (error) {
				console.error("Error fetching invocations", error);
				Sentry.captureException(error);
				throw new Error("Failed to fetch invocations");
			}
		});
	});
