import { z } from "zod";

// --- Action / Logic Schema ---

export type LogicAction =
    | { type: "SET"; key: string; value: any }
    | { type: "TOGGLE"; key: string }
    | { type: "INCREMENT"; key: string; amount?: number }
    | { type: "API_CALL"; url: string; method?: "GET" | "POST"; body?: any; onSuccess?: LogicAction[]; onError?: LogicAction[] }
    | { type: "NAVIGATE"; url: string }
    | { type: "DELAY"; ms: number; actions: LogicAction[] };

export const LogicActionSchema: z.ZodType<LogicAction> = z.lazy(() =>
    z.union([
        z.object({ type: z.literal("SET"), key: z.string(), value: z.any() }),
        z.object({ type: z.literal("TOGGLE"), key: z.string() }),
        z.object({ type: z.literal("INCREMENT"), key: z.string(), amount: z.number().optional() }),
        z.object({
            type: z.literal("API_CALL"),
            url: z.string(),
            method: z.enum(["GET", "POST"]).optional(),
            body: z.any().optional(),
            onSuccess: z.array(LogicActionSchema).optional(),
            onError: z.array(LogicActionSchema).optional(),
        }),
        z.object({ type: z.literal("NAVIGATE"), url: z.string() }),
        z.object({ type: z.literal("DELAY"), ms: z.number(), actions: z.array(LogicActionSchema) }),
    ])
);

// --- Component Schema ---

export type ComponentType =
    // Layout
    | "box" | "flex" | "grid" | "container" | "section"
    // Surfaces
    | "card" | "panel"
    // Data Display
    | "text" | "heading" | "metric" | "table" | "chart" | "list" | "image" | "icon"
    // Feedback
    | "alert" | "progress" | "badge"
    // Form
    | "input" | "button" | "select" | "switch" | "slider"
    // Logic
    | "iterator" | "data-provider";

export interface AIComponent {
    id?: string;
    type: ComponentType;
    props: Record<string, any>;
    children?: any[]; // Relaxed to allow strings/mixed content
    // Logic & State
    visibleIf?: string; // Condition string: "state.count > 5"
    bind?: string; // State key to bind to: "state.user.name"
    events?: {
        onClick?: LogicAction[];
        onChange?: LogicAction[];
        onMount?: LogicAction[];
    };
    // Layout overrides
    style?: Record<string, any>;
}

export const AIComponentSchema: z.ZodType<AIComponent> = z.lazy(() =>
    z.object({
        id: z.string().optional(),
        type: z.string() as z.ZodType<ComponentType>,
        props: z.record(z.any()).default({}),
        children: z.array(z.any()).optional(), // Relaxed validation
        visibleIf: z.string().optional(),
        bind: z.string().optional(),
        events: z.object({
            onClick: z.array(LogicActionSchema).optional(),
            onChange: z.array(LogicActionSchema).optional(),
            onMount: z.array(LogicActionSchema).optional(),
        }).optional(),
        style: z.record(z.any()).optional(),
    })
);

// --- App Definition Schema ---

export interface AIAppTheme {
    mode?: "light" | "dark";
    colors?: {
        primary?: string;
        secondary?: string;
        background?: string;
        text?: string;
        accent?: string;
    };
    typography?: {
        fontFamily?: string;
        fontSize?: string;
    };
    borderRadius?: string;
}

export interface AIAppDefinition {
    initialState?: Record<string, any>;
    theme?: AIAppTheme;
    root: AIComponent;
}

export const AIAppDefinitionSchema = z.object({
    initialState: z.record(z.any()).optional(),
    theme: z.object({
        mode: z.enum(["light", "dark"]).optional(),
        colors: z.record(z.string()).optional(),
        typography: z.record(z.string()).optional(),
        borderRadius: z.string().optional(),
    }).optional(),
    root: AIComponentSchema,
});
