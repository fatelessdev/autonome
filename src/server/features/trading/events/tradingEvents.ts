import { EventEmitter } from "node:events";

export type TradingWorkflowEvent =
	| {
			type: "workflow:complete";
			modelId: string;
			timestamp: string;
	  }
	| {
			type: "batch:complete";
			modelIds: string[];
			timestamp: string;
	  };

const emitter = new EventEmitter();
emitter.setMaxListeners(50);

const EVENT_KEY = "trading-update";

export const emitTradingEvent = (event: TradingWorkflowEvent) => {
	emitter.emit(EVENT_KEY, event);
};

export const subscribeToTradingEvents = (
	listener: (event: TradingWorkflowEvent) => void,
) => {
	emitter.on(EVENT_KEY, listener);
	return () => {
		emitter.off(EVENT_KEY, listener);
	};
};
