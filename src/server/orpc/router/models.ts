import "@/polyfill";

import { os } from "@orpc/server";
import * as Sentry from "@sentry/react";
import { z } from "zod";

import { refreshConversationEvents } from "@/server/features/trading/data/conversationsSnapshot.server";
import { fetchModelsList } from "@/server/features/trading/data/tradingQueries.server";
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
				Sentry.captureException(error);
				throw new Error("Failed to fetch models");
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
