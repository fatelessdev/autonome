import { describe, expect, it } from "vitest";
import {
	emitPositionEvent,
	getCurrentPositions,
	getPositionCacheMetadata,
	subscribeToPositionEvents,
} from "./positionEvents";

describe("positionEvents", () => {
	it("exports expected members", () => {
		expect(emitPositionEvent).toBeDefined();
		expect(subscribeToPositionEvents).toBeDefined();
		expect(getCurrentPositions).toBeDefined();
		expect(getPositionCacheMetadata).toBeDefined();
	});
});
