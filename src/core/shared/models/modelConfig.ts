export const MODEL_INFO: Record<
	string,
	{ logo: string; color: string; label: string }
> = {
	"deepseek-v3.1-terminus": {
		logo: "/models/deepseek.png",
		color: "#4D6BFE",
		label: "DeepSeek V3.1 Terminus",
	},
	"deepseek-v3.1": {
		logo: "/models/deepseek.png",
		color: "#4D6BFE",
		label: "DeepSeek V3.1",
	},
	"deepseek-r1t2-chimera": {
		logo: "/models/deepseek.png",
		color: "#4D6BFE",
		label: "DeepSeek R1T2 Chimera",
	},
	"deepseek-r1-0528": {
		logo: "/models/deepseek.png",
		color: "#4D6BFE",
		label: "DeepSeek R1 0528",
	},
	"claude-sonnet-4.5": {
		logo: "/models/claude.png",
		color: "#FF6B35",
		label: "Claude Sonnet 4.5",
	},
	"grok-4.1-fast": {
		logo: "/models/grok.webp",
		color: "#000000",
		label: "Grok 4.1",
	},
	"qwen3-max": {
		logo: "https://nof1.ai/logos_white/qwen_logo.png",
		color: "#8B5CF6",
		label: "Qwen3 Max",
	},
	"qwen3-235b-a22b": {
		logo: "https://nof1.ai/logos_white/qwen_logo.png",
		color: "#8B5CF6",
		label: "Qwen3 235B A22B",
	},
	"glm-4.5-air": {
		logo: "/models/glm.svg",
		color: "#343333",
		label: "GLM 4.5 Air",
	},
	"minimax-m2": {
		logo: "/models/minimax.png",
		color: "#E62176",
		label: "Minimax M2",
	},
};

export function getModelInfo(modelName: string): {
	logo: string;
	color: string;
	label: string;
} {
	if (MODEL_INFO[modelName]) {
		return MODEL_INFO[modelName];
	}

	return {
		logo: "",
		color: "#888888",
		label: modelName,
	};
}
