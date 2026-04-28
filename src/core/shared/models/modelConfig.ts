export type ModelProvider = "nim" | "openrouter" | "aihubmix";

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
		provider: "openrouter",
	},
	"mimo-v2-flash-free": {
		logo: "/models/mimo.png",
		color: "#FF6900",
		label: "Mimo V2 Flash Free",
		provider: "aihubmix",
	},
	"coding-glm-4.7-free": {
		logo: "/models/glm.svg",
		color: "#343333",
		label: "Coding GLM 4.7",
		provider: "aihubmix",
	},
	"glm4.7": {
		logo: "/models/glm.svg",
		color: "#242323",
		label: "GLM 4.7",
		provider: "aihubmix",
	},
	"grok-4.1-fast": {
		logo: "/models/grok.webp",
		color: "#000000",
		label: "Grok 4.1",
		provider: "openrouter",
	},
	"step-3.5-flash": {
		logo: "/models/stepfun.png",
		color: "#f1f2f5",
		label: "Step 3.5 Flash",
		provider: "nim",
	},
	"qwen3-max": {
		logo: "/models/qwen.png",
		color: "#8B5CF6",
		label: "Qwen3 Max",
		provider: "openrouter",
	},
	"qwen3-235b-a22b": {
		logo: "/models/qwen.png",
		color: "#8B5CF6",
		label: "Qwen3 235B A22B",
		provider: "nim",
	},
	"glm-4.5-air": {
		logo: "/models/glm.svg",
		color: "#343333",
		label: "GLM 4.5 Air",
		provider: "openrouter",
	},
	"minimax-m2.5": {
		logo: "/models/minimax.png",
		color: "#E62176",
		label: "Minimax M2.5",
		provider: "nim",
	},
	"gpt-oss-120b": {
		logo: "/models/gpt.png",
		color: "#10A37F",
		label: "GPT-OSS 120B",
		provider: "nim",
	},
	"kimi-for-coding-free": {
		logo: "/models/kimi.png",
		color: "#343333",
		label: "Coding Kimi K2.5",
		provider: "aihubmix",
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
	"coding-minimax-m2.1-free": {
		logo: "/models/minimax.png",
		color: "#ef73a9",
		label: "Coding Minimax M2.1",
		provider: "aihubmix",
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
 * Throws if model is not registered in MODEL_INFO.
 */
export function getModelInfo(modelName: string): ModelInfo {
	const info = findModelInfo(modelName);
	if (!info) {
		throw new Error(
			`Unknown model "${modelName}". Register it in MODEL_INFO before use.`,
		);
	}
	return info;
}

/**
 * Look up model info by name, returning null if not found.
 * Use for exploratory lookups where the model may not be registered.
 */
export function findModelInfo(modelName: string): ModelInfo | null {
	if (MODEL_INFO[modelName]) {
		return MODEL_INFO[modelName];
	}

	const normalizedInput = normalizeModelName(modelName);
	for (const [key, value] of Object.entries(MODEL_INFO)) {
		if (normalizeModelName(key) === normalizedInput) {
			return value;
		}
	}

	return null;
}

export function getModelProvider(modelName: string): ModelProvider {
	const info = getModelInfo(modelName);
	if (!info.provider) {
		throw new Error(
			`Model "${modelName}" has no provider configured in MODEL_INFO.`,
		);
	}
	return info.provider;
}
