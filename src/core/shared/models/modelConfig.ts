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
	"deepseek-v3.1": {
		logo: "/models/deepseek.png",
		color: "#4D6BFE",
		label: "DeepSeek V3.1",
		provider: "nim",
	},
	"deepseek-r1t2-chimera": {
		logo: "/models/deepseek.png",
		color: "#4D6BFE",
		label: "DeepSeek R1T2 Chimera",
		provider: "openrouter",
	},
	"deepseek-r1-0528": {
		logo: "/models/deepseek.png",
		color: "#4D6BFE",
		label: "DeepSeek R1 0528",
		provider: "nim",
	},
	"claude-sonnet-4.5": {
		logo: "/models/claude.png",
		color: "#FF6B35",
		label: "Claude Sonnet 4.5",
		provider: "openrouter",
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
	"qwen3-235b-a22b": {
		logo: "/models/qwen.png",
		color: "#8B5CF6",
		label: "Qwen3 235B",
		provider: "nim",
	},
	"qwen3-coder-480b-a35b-instruct": {
		logo: "/models/qwen.png",
		color: "#8B5CF6",
		label: "Qwen3 Coder 480B",
		provider: "nim",
	},
	"qwen3-next-80b-a3b-thinking": {
		logo: "/models/qwen.png",
		color: "#8B5CF6",
		label: "Qwen3 Next 80B",
		provider: "nim",
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
	"kimi-k2-instruct-0905": {
		logo: "/models/kimi.png",
		color: "#121212",
		label: "Kimi K2 Instruct",
		provider: "nim",
	},
};

export type ModelInfo = ModelInfoEntry & { provider?: ModelProvider };

export function getModelInfo(modelName: string): ModelInfo {
	if (MODEL_INFO[modelName]) {
		return MODEL_INFO[modelName];
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
