import { describe, it, expect } from "vitest";
import { createTypedEventBus } from "./typedEventBus";

describe("typedEventBus", () => {
	it("delivers emitted events to subscribers", () => {
		const bus = createTypedEventBus<{ value: number }>("test");
		const received: { value: number }[] = [];

		bus.subscribe((event) => received.push(event));
		bus.emit({ value: 1 });
		bus.emit({ value: 2 });

		expect(received).toEqual([{ value: 1 }, { value: 2 }]);
	});

	it("supports multiple subscribers", () => {
		const bus = createTypedEventBus<string>("test");
		const received1: string[] = [];
		const received2: string[] = [];

		bus.subscribe((event) => received1.push(event));
		bus.subscribe((event) => received2.push(event));
		bus.emit("hello");

		expect(received1).toEqual(["hello"]);
		expect(received2).toEqual(["hello"]);
	});

	it("unsubscribe stops receiving events", () => {
		const bus = createTypedEventBus<string>("test");
		const received: string[] = [];

		const unsubscribe = bus.subscribe((event) => received.push(event));
		bus.emit("before");
		unsubscribe();
		bus.emit("after");

		expect(received).toEqual(["before"]);
	});

	it("does not cross-pollinate between different keys", () => {
		const bus1 = createTypedEventBus<string>("key1");
		const bus2 = createTypedEventBus<string>("key2");
		const received1: string[] = [];
		const received2: string[] = [];

		bus1.subscribe((event) => received1.push(event));
		bus2.subscribe((event) => received2.push(event));
		bus1.emit("from-bus1");

		expect(received1).toEqual(["from-bus1"]);
		expect(received2).toEqual([]);
	});

	it("unsubscribing one subscriber does not affect others", () => {
		const bus = createTypedEventBus<string>("test");
		const received1: string[] = [];
		const received2: string[] = [];

		const unsub1 = bus.subscribe((event) => received1.push(event));
		bus.subscribe((event) => received2.push(event));
		unsub1();
		bus.emit("event");

		expect(received1).toEqual([]);
		expect(received2).toEqual(["event"]);
	});

	it("returns a typed bus structure", () => {
		const bus = createTypedEventBus<{ x: number }>("test");
		expect(typeof bus.emit).toBe("function");
		expect(typeof bus.subscribe).toBe("function");
	});
});
