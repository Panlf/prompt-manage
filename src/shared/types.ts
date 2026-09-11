// Shared data types & utilities used by both bun backend and webview frontend

export type Scenario = {
	id: number;
	name: string;
	description: string;
	tags: string[];
	prompt_count: number;
	created_at: string;
	updated_at: string;
};

export type Tag = {
	id: number;
	name: string;
	count: number;
};

export type Prompt = {
	id: number;
	scenario_id: number;
	title: string;
	content: string;
	is_favorite: number; // 0 | 1
	use_count: number;
	last_used_at: string | null;
	deleted_at: string | null; // soft-delete timestamp; null = active
	tags: string[]; // prompt-level tags (filled by queries)
	created_at: string;
	updated_at: string;
};

export type PromptVersion = {
	id: number;
	prompt_id: number;
	version_number: number;
	content: string;
	note: string;
	created_at: string;
};

export type PrecheckRun = {
	id: number;
	prompt_id: number;
	type: string; // "text" | "image" | "optimize"
	input_text: string;
	output_text: string;
	model_name: string;
	created_at: string;
};

export type LLMConfig = {
	id: number;
	name: string;
	provider: string; // "deepseek" | "mimo" | "ollama" | "custom"
	api_key: string;
	base_url: string;
	model: string;
	is_active: number;
	created_at: string;
};

// A prompt joined with its scenario name, used by cross-scenario views
export type PromptWithScenario = Prompt & {
	scenario_name: string;
};

export type SearchResults = {
	scenarios: Scenario[];
	prompts: PromptWithScenario[];
};

export type DashboardStats = {
	scenario_count: number;
	prompt_count: number;
	favorite_count: number;
	total_uses: number;
};

// Sort orders for the all-prompts view
export type PromptSort = "recent" | "most_used" | "updated";

// Full backup format (v2.1: prompt-level tag tables; all new parts optional on import)
export type ExportData = {
	scenarios: Omit<Scenario, "tags" | "prompt_count">[];
	tags: { id: number; name: string; created_at: string }[];
	scenario_tags: { scenario_id: number; tag_id: number }[];
	prompts: Prompt[];
	prompt_versions: PromptVersion[];
	precheck_runs: PrecheckRun[];
	// api_key 可选：导出有意剔除密钥；导入同时兼容带/不带密钥的备份
	llm_configs: (Omit<LLMConfig, "api_key"> & { api_key?: string })[];
	prompt_tags?: { id: number; name: string; created_at: string }[];
	prompt_tag_map?: { prompt_id: number; tag_id: number }[];
};

// Provider default configurations
export const PROVIDER_DEFAULTS: Record<string, { base_url: string; model: string }> = {
	deepseek: { base_url: "https://api.deepseek.com/v1", model: "deepseek-chat" },
	mimo: { base_url: "https://api.mimo.xiaomi.com/v1", model: "MiMo-7B-RL" },
	ollama: { base_url: "http://localhost:11434/v1", model: "llama3" },
	custom: { base_url: "", model: "" },
};

// ---- Template variable engine ({{variable}}) ----
// Shared by backend & frontend; unit-tested in tests/variables.test.ts

/**
 * Variable names: letters (incl. CJK), digits, underscore and hyphen.
 * At least one non-digit character is required so `{{2023}}` stays literal text.
 */
const VAR_NAME = /^[A-Za-z0-9_\-\u4e00-\u9fff]+$/;
const VAR_FIRST_CHAR_DIGIT = /^\d/;

/**
 * Extract unique {{variable}} placeholders from prompt content, in order of first appearance.
 */
export function extractVariables(content: string): string[] {
	const found: string[] = [];
	const re = /\{\{([^{}]*)\}\}/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(content)) !== null) {
		const name = m[1].trim();
		if (!name || !VAR_NAME.test(name) || VAR_FIRST_CHAR_DIGIT.test(name)) continue;
		if (!found.includes(name)) found.push(name);
	}
	return found;
}

/**
 * Replace {{variable}} placeholders with provided values.
 * Unfilled variables are kept as-is ({{name}}) so the user can spot them in the preview.
 * Longest-first replacement prevents a name that prefixes another from clobbering it
 * (e.g. {{lang}} vs {{language}}).
 */
export function fillVariables(content: string, values: Record<string, string>): string {
	let result = content;
	const names = extractVariables(content).sort((a, b) => b.length - a.length);
	for (const name of names) {
		const v = values[name];
		if (v === undefined) continue;
		result = result.split(`{{${name}}}`).join(v);
	}
	return result;
}
