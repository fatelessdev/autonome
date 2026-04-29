import { describe, it, expect } from "vitest";
import { emitPositionEvent, subscribeToPositionEvents, getCurrentPositions, getPositionCacheMetadata } from "./positionEvents";

describe("positionEvents", () => {
	it("exports expected members", () => {
		expect(emitPositionEvent).toBeDefined();
		expect(subscribeToPositionEvents).toBeDefined();
		expect(getCurrentPositions).toBeDefined();
		expect(getPositionCacheMetadata).toBeDefined();
	});
});
