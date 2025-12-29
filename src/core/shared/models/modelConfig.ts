export type ModelProvider = "nim" | "openrouter";

type ModelInfoEntry = {
	logo: string;
	color: string;
	label: string;
	provider?: ModelProvider;
};

export const MODEL_INFO: Record<string, ModelInfoEntry> = {
	"deepseek-v3.1-terminus": {
		logo: "/models/deepseek.png",
		color: "#4D6BFE",
		label: "DeepSeek V3.1 Terminus",
		provider: "nim",
	},
	"deepseek-v3.2": {
		logo: "/models/deepseek.png",
		color: "#4D6BFE",
		label: "DeepSeek V3.2",
		provider: "nim",
	},
	"kat-coder-pro": {
		logo: "/models/kwaipilot.png",
		color: "#31DAF3",
		label: "Kat Coder Pro",
		provider: "openrouter",
	},
	"mimo-v2-flash": {
		logo: "/models/mimo.png",
		color: "#FF6900",
		label: "Mimo V2 Flash",
		provider: "openrouter"
	},
	"grok-4.1-fast": {
		logo: "/models/grok.webp",
		color: "#000000",
		label: "Grok 4.1",
		provider: "openrouter",
	},
	"qwen3-max": {
		logo: "/models/qwen.png",
		color: "#8B5CF6",
		label: "Qwen3 Max",
		provider: "openrouter",
	},
	"glm-4.5-air": {
		logo: "/models/glm.svg",
		color: "#343333",
		label: "GLM 4.5 Air",
		provider: "openrouter",
	},
	"minimax-m2": {
		logo: "/models/minimax.png",
		color: "#E62176",
		label: "Minimax M2",
		provider: "nim",
	},
	"gpt-oss-120b": {
		logo: "/models/gpt.png",
		color: "#10A37F",
		label: "GPT-OSS 120B",
		provider: "nim",
	},
	"kimi-k2-thinking": {
		logo: "/models/kimi.png",
		color: "#343333",
		label: "Kimi K2 Thinking",
		provider: "nim",
	},
	"mistral-large-3-675b-instruct-2512": {
		logo: "/models/mistral.png",
		color: "#FF8301",
		label: "Mistral Large 3 675B",
		provider: "nim",
	},
};

export type ModelInfo = ModelInfoEntry & { provider?: ModelProvider };

/**
 * Normalize model name for matching.
 * Handles variations like casing and extra characters.
 */
function normalizeModelName(name: string): string {
	return name
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9-]/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "");
}

/**
 * Get model info by name.
 * Attempts exact match first, then normalized match.
 */
export function getModelInfo(modelName: string): ModelInfo {
	// Exact match
	if (MODEL_INFO[modelName]) {
		return MODEL_INFO[modelName];
	}

	// Normalized match
	const normalizedInput = normalizeModelName(modelName);
	for (const [key, value] of Object.entries(MODEL_INFO)) {
		if (normalizeModelName(key) === normalizedInput) {
			return value;
		}
	}

	return {
		logo: "",
		color: "#888888",
		label: modelName,
		provider: "nim",
	};
}

export function getModelProvider(modelName: string): ModelProvider {
	const entry = MODEL_INFO[modelName];
	return entry?.provider ?? "nim";
}
