	export const MODEL_INFO: Record<
	string,
	{ logo: string; color: string; label: string }
> = {
	"deepseek-v3.1-terminus": {
		logo: "https://nof1.ai/logos_white/deepseek_logo.png",
		color: "#4D6BFE",
		label: "DeepSeek V3.1 Terminus",
	},
	"deepseek-v3.1": {
		logo: "https://nof1.ai/logos_white/deepseek_logo.png",
		color: "#4D6BFE",
		label: "DeepSeek V3.1",
	},
	"deepseek-r1t2-chimera": {
		logo: "https://nof1.ai/logos_white/deepseek_logo.png",
		color: "#4D6BFE",
		label: "DeepSeek R1T2 Chimera",
	},
	"deepseek-r1-0528": {
		logo: "https://nof1.ai/logos_white/deepseek_logo.png",
		color: "#4D6BFE",
		label: "DeepSeek R1 0528",
	},
	"claude-sonnet-4.5": {
		logo: "https://nof1.ai/logos_white/Claude_logo.png",
		color: "#FF6B35",
		label: "Claude Sonnet 4.5",
	},
	"grok-4.1-fast": {
		logo: "/grok.webp",
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
		logo: "/glm.svg",
		color: "#343333",
		label: "GLM 4.5 Air",
	},
	"minimax-m2": {
		logo: "/minimax.png",
		color: "#E62176",
		label: "Minimax M2",
	},
	"polaris-alpha": {
		logo: "https://nof1.ai/logos_white/GPT_logo.png",
		color: "#00C2FF",
		label: "Polaris Alpha",
	},
	"gpt-oss-120b": {
		logo: "https://nof1.ai/logos_white/GPT_logo.png",
		color: "#16AC86",
		label: "GPT OSS 120B",
	},
};

const deriveModelCandidates = (rawName: string): string[] => {
	const trimmed = (rawName ?? "").trim();
	if (!trimmed) {
		return [];
	}

	const candidates = new Set<string>();
	const add = (value: string | undefined | null) => {
		if (!value) return;
		const candidate = value.trim();
		if (candidate) {
			candidates.add(candidate);
			candidates.add(candidate.toLowerCase());
		}
	};

	add(trimmed);

	const afterSlash = trimmed.includes("/")
		? (trimmed.split("/").pop() ?? trimmed)
		: trimmed;
	add(afterSlash);

	const beforeColon = trimmed.includes(":") ? trimmed.split(":")[0] : trimmed;
	add(beforeColon);

	const afterSlashBeforeColon = afterSlash.includes(":")
		? afterSlash.split(":")[0]
		: afterSlash;
	add(afterSlashBeforeColon);

	const expanded = Array.from(candidates);
	for (const candidate of expanded) {
		const normalized = candidate
			.toLowerCase()
			.replace(/[\s_.]+/g, "-")
			.replace(/[/:]+/g, "-")
			.replace(/[^a-z0-9-]/g, "-")
			.replace(/-+/g, "-")
			.replace(/^-|-$/g, "");
		if (normalized) {
			candidates.add(normalized);
		}
	}

	return Array.from(candidates).filter(Boolean);
};

export function getModelInfo(modelName: string): {
	logo: string;
	color: string;
	label: string;
} {
	const candidates = deriveModelCandidates(modelName);
	for (const candidate of candidates) {
		if (MODEL_INFO[candidate]) {
			return MODEL_INFO[candidate];
		}
	}

	return {
		logo: "",
		color: "#888888",
		label: modelName,
	};
}
