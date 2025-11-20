import React, { createContext, useContext, useReducer, useEffect, useCallback } from "react";
import { AIAppDefinition, LogicAction } from "@/types/ai-ui";

// --- State Management ---

interface AIStateContextType {
    state: Record<string, any>;
    dispatch: (action: LogicAction | LogicAction[]) => void;
    resolveValue: (value: any) => any;
}

const AIStateContext = createContext<AIStateContextType | null>(null);

type Action =
    | { type: "UPDATE_STATE"; key: string; value: any }
    | { type: "RESET_STATE"; initialState: Record<string, any> };

function stateReducer(state: Record<string, any>, action: Action) {
    switch (action.type) {
        case "UPDATE_STATE": {
            // Handle deep updates (e.g., "user.name")
            const keys = action.key.split(".");
            if (keys.length === 1) {
                return { ...state, [action.key]: action.value };
            }

            const newState = { ...state };
            let current = newState;
            for (let i = 0; i < keys.length - 1; i++) {
                if (!current[keys[i]]) current[keys[i]] = {};
                current = current[keys[i]];
            }
            current[keys[keys.length - 1]] = action.value;
            return newState;
        }
        case "RESET_STATE":
            return action.initialState;
        default:
            return state;
    }
}

// --- Logic Engine ---

const evaluateExpression = (expression: string, state: Record<string, any>) => {
    try {
        // SAFE EVALUATION: Replace state variables with values
        // This is a simple regex replacer. For production, use a proper parser like jsep.
        // Supporting "state.count" -> value

        const keys = Object.keys(state);
        const values = Object.values(state);

        // Create a function with state keys as arguments
        // eslint-disable-next-line no-new-func
        const func = new Function(...keys, `return ${expression};`);
        return func(...values);
    } catch (e) {
        console.warn("Failed to evaluate expression:", expression, e);
        return false;
    }
};

export function AIStateProvider({
    initialState = {},
    children,
}: {
    initialState?: Record<string, any>;
    children: React.ReactNode;
}) {
    const [state, dispatchState] = useReducer(stateReducer, initialState);

    // Reset state when initialState prop changes (new app generated)
    useEffect(() => {
        dispatchState({ type: "RESET_STATE", initialState });
    }, [initialState]);

    const resolveValue = useCallback((value: any): any => {
        if (typeof value === "string" && value.startsWith("{") && value.endsWith("}")) {
            const path = value.slice(1, -1).trim();

            // Handle "state.foo"
            if (path.startsWith("state.")) {
                const key = path.replace("state.", "");
                const keys = key.split(".");
                let current = state;
                for (const k of keys) {
                    current = current?.[k];
                }
                return current;
            }

            // Handle simple math expressions inside {} like {state.count + 1}
            // This is risky without a proper parser, sticking to direct access for now
            // or using the evaluateExpression helper if needed.
        }
        return value;
    }, [state]);

    const executeAction = useCallback(async (action: LogicAction) => {
        console.log("[AI Engine] Executing action:", action);

        switch (action.type) {
            case "SET": {
                const resolvedValue = resolveValue(action.value);
                dispatchState({ type: "UPDATE_STATE", key: action.key, value: resolvedValue });
                break;
            }
            case "TOGGLE": {
                const currentValue = resolveValue(`{state.${action.key}}`);
                dispatchState({ type: "UPDATE_STATE", key: action.key, value: !currentValue });
                break;
            }
            case "INCREMENT": {
                const currentValue = resolveValue(`{state.${action.key}}`) || 0;
                const amount = action.amount || 1;
                dispatchState({ type: "UPDATE_STATE", key: action.key, value: currentValue + amount });
                break;
            }
            case "DELAY": {
                await new Promise((resolve) => setTimeout(resolve, action.ms));
                if (action.actions) {
                    action.actions.forEach(a => executeAction(a));
                }
                break;
            }
            case "API_CALL": {
                try {
                    const response = await fetch(action.url, {
                        method: action.method || "GET",
                        body: action.body ? JSON.stringify(action.body) : undefined,
                        headers: action.body ? { "Content-Type": "application/json" } : undefined
                    });
                    const data = await response.json();

                    // If success, we might want to store the data
                    // For now, we just run onSuccess actions
                    if (action.onSuccess) {
                        // We need a way to pass the result to the next actions.
                        // For now, let's assume we set it to a temp state or the user defines where to put it.
                        // A better way: "SET" action with value "{lastResult}"
                        action.onSuccess.forEach(a => executeAction(a));
                    }
                } catch (error) {
                    if (action.onError) {
                        action.onError.forEach(a => executeAction(a));
                    }
                }
                break;
            }
            case "NAVIGATE": {
                window.location.href = action.url;
                break;
            }
        }
    }, [state, resolveValue]);

    const dispatch = useCallback((actionOrActions: LogicAction | LogicAction[]) => {
        if (Array.isArray(actionOrActions)) {
            actionOrActions.forEach(executeAction);
        } else {
            executeAction(actionOrActions);
        }
    }, [executeAction]);

    return (
        <AIStateContext.Provider value={{ state, dispatch, resolveValue }}>
            {children}
        </AIStateContext.Provider>
    );
}

export function useAIState() {
    const context = useContext(AIStateContext);
    if (!context) {
        throw new Error("useAIState must be used within an AIStateProvider");
    }
    return context;
}
