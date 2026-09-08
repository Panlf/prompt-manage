import Electrobun, { Electroview } from "electrobun/view";
import type { Scenario, Tag, Prompt, PromptVersion, PrecheckRun, LLMConfig, PromptWithScenario, SearchResults, DashboardStats } from "../shared/types";
import { PROVIDER_DEFAULTS } from "../shared/types";

// ---- RPC type (frontend version, no RPCSchema wrapper) ----
type AppRPC = {
	bun: {
		requests: {
			getScenarios: { params: { tag?: string }; response: Scenario[] };
			getScenario: { params: { id: number }; response: Scenario };
			createScenario: { params: { name: string; description: string; tags: string[] }; response: Scenario };
			updateScenario: { params: { id: number; name: string; description: string; tags: string[] }; response: Scenario };
			deleteScenario: { params: { id: number }; response: { success: boolean } };

			getAllTags: { params: {}; response: Tag[] };
			renameTag: { params: { id: number; name: string }; response: Tag };
			deleteTag: { params: { id: number }; response: { success: boolean } };

			getPrompts: { params: { scenario_id: number }; response: Prompt[] };
			getPrompt: { params: { id: number }; response: Prompt };
			createPrompt: { params: { scenario_id: number; title: string; content: string; source: string; model_name?: string; tags?: string[] }; response: Prompt };
			updatePrompt: { params: { id: number; title: string; content: string; tags?: string[] }; response: Prompt };
			trashPrompt: { params: { id: number }; response: { success: boolean } };
			restorePrompt: { params: { id: number }; response: Prompt };
			purgePrompt: { params: { id: number }; response: { success: boolean } };
			emptyTrash: { params: {}; response: { purged: number } };
			getTrashedPrompts: { params: {}; response: PromptWithScenario[] };

			getAllPromptTags: { params: {}; response: Tag[] };

			togglePromptFavorite: { params: { id: number }; response: Prompt };
			recordPromptUse: { params: { id: number }; response: { success: boolean } };
			getFavoritePrompts: { params: {}; response: PromptWithScenario[] };
			getAllPrompts: { params: { sort: string; favorite?: boolean; source?: string; tag?: string }; response: PromptWithScenario[] };
			getRecentPrompts: { params: { limit: number }; response: PromptWithScenario[] };

			getDashboardStats: { params: {}; response: DashboardStats };
			searchAll: { params: { query: string }; response: SearchResults };

			getPromptVersions: { params: { prompt_id: number }; response: PromptVersion[] };
			savePromptVersion: { params: { prompt_id: number; content: string; note: string }; response: PromptVersion };

			getPrecheckRuns: { params: { prompt_id: number }; response: PrecheckRun[] };
			runPrecheck: { params: { prompt_id: number; type: string; input_text: string; llm_config_id: number }; response: PrecheckRun };

			generatePromptAI: { params: { scenario_name: string; description: string; llm_config_id: number }; response: { content: string } };

			getLLMConfigs: { params: {}; response: LLMConfig[] };
			createLLMConfig: { params: { name: string; provider: string; api_key: string; base_url: string; model: string }; response: LLMConfig };
			updateLLMConfig: { params: { id: number; name: string; provider: string; api_key: string; base_url: string; model: string }; response: LLMConfig };
			deleteLLMConfig: { params: { id: number }; response: { success: boolean } };
			setActiveLLMConfig: { params: { id: number }; response: { success: boolean } };
			testLLMConfig: { params: { id: number }; response: { success: boolean; message: string } };

			exportData: { params: {}; response: { data: string } };
			importData: { params: { data: string }; response: { success: boolean; message: string } };
			getDataPath: { params: {}; response: { current: string; default: string; custom: string | null; dbPath: string; configSource: string; portableConfigPath: string } };
			migrateData: { params: { newPath: string }; response: { success: boolean; newPath: string; message: string } };
			validateDataDir: { params: { path: string }; response: { ok: boolean; message: string } };

			// Window controls
			windowMinimize: { params: {}; response: void };
			windowMaximize: { params: {}; response: void };
			windowClose: { params: {}; response: void };
			windowIsMaximized: { params: {}; response: boolean };
			windowGetPosition: { params: {}; response: { x: number; y: number } };
			windowSetPosition: { params: { x: number; y: number }; response: void };
		};
		messages: {};
	};
	webview: {
		requests: {};
		messages: {};
	};
};

// ---- RPC client ----
const rpcChannel = Electroview.defineRPC<AppRPC>({
	maxRequestTime: 120000,
	handlers: { requests: {}, messages: {} },
});

export const electrobun = new Electrobun.Electroview({ rpc: rpcChannel });
export { PROVIDER_DEFAULTS };

// ---- State ----
export type ViewName =
	| "dashboard"
	| "scenarios"
	| "scenario-detail"
	| "prompt-detail"
	| "all-prompts"
	| "favorites"
	| "trash"
	| "settings"
	| "data";

export const state = {
	view: "dashboard" as ViewName,
	scenarioId: null as number | null,
	promptId: null as number | null,
	// Which sidebar entry the current prompt-detail was opened from
	promptOrigin: "scenarios" as ViewName,
	scenarios: [] as Scenario[],
	tags: [] as Tag[],
	llmConfigs: [] as LLMConfig[],
};

// ---- Form drafts ----
// 业务弹窗关闭（误触/Esc）时保留已填内容，重新打开自动恢复；
// 仅在保存成功或切换页面时清空（见 navigate / openPrompt）。
export const drafts: {
	scenario: { name: string; description: string; tags: string } | null;
	prompt: { title: string; tags: string; content: string; aiDesc: string } | null;
} = { scenario: null, prompt: null };

function clearDrafts() {
	drafts.scenario = null;
	drafts.prompt = null;
}

// ---- Navigation & rendering ----
let renderFn: (() => void) | null = null;

export function setRenderFn(fn: () => void) {
	renderFn = fn;
}

export function rerender() {
	renderFn?.();
}

export function navigate(view: ViewName, scenarioId?: number | null, promptId?: number | null) {
	state.view = view;
	if (scenarioId !== undefined) state.scenarioId = scenarioId;
	if (promptId !== undefined) state.promptId = promptId;
	clearDrafts(); // 切换页面 = 放弃未保存的草稿
	rerender();
}

/** Navigate into a prompt detail, tagging which view it was opened from. */
export function openPrompt(promptId: number, scenarioId: number, origin: ViewName) {
	state.promptId = promptId;
	state.scenarioId = scenarioId;
	state.promptOrigin = origin;
	state.view = "prompt-detail";
	clearDrafts();
	rerender();
}

// ---- Data loading ----
export async function loadScenarios(tag?: string) {
	state.scenarios = await electrobun.rpc!.request.getScenarios({ tag });
}

export async function loadTags() {
	state.tags = await electrobun.rpc!.request.getAllTags({});
}

export async function loadLLMConfigs() {
	state.llmConfigs = await electrobun.rpc!.request.getLLMConfigs({});
}

export async function loadAll() {
	await Promise.all([loadScenarios(), loadTags(), loadLLMConfigs()]);
}

// ---- Utilities ----
// String-based escaping: also escapes quotes, so values are safe inside HTML
// attributes (value="...", data-x="..."), not just element content.
export function escapeHtml(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

/** Escape a string for safe interpolation into a RegExp source. */
export function escapeRegExp(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Highlight all case-insensitive occurrences of `query` inside `text` with <mark>. */
export function highlightHtml(text: string, query: string): string {
	const escaped = escapeHtml(text);
	const q = query.trim();
	if (!q) return escaped;
	// Both sides are escaped with the same rules, so the escaped query still matches
	const re = new RegExp(`(${escapeRegExp(escapeHtml(q))})`, "gi");
	return escaped.replace(re, "<mark>$1</mark>");
}

export function formatDate(str: string | null): string {
	if (!str) return "";
	try {
		const d = new Date(str + "Z");
		return d.toLocaleString("zh-CN", {
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
		});
	} catch {
		return str;
	}
}

export function showToast(message: string, type: "success" | "error" | "info" = "info") {
	const toast = document.createElement("div");
	toast.className = `toast toast-${type}`;
	toast.textContent = message;
	document.body.appendChild(toast);
	// Trigger animation
	requestAnimationFrame(() => toast.classList.add("show"));
	setTimeout(() => {
		toast.classList.remove("show");
		setTimeout(() => toast.remove(), 300);
	}, 3000);
}

/** Run an async action, showing an error toast (never throwing) on failure. Returns true on success. */
export async function withToast(action: () => Promise<unknown>, failTitle = "操作失败"): Promise<boolean> {
	try {
		await action();
		return true;
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		showToast(`${failTitle}: ${msg}`, "error");
		return false;
	}
}

// Global safety net: any unhandled promise rejection surfaces as a toast
// instead of failing silently in the console.
window.addEventListener("unhandledrejection", (e) => {
	const reason: unknown = e.reason;
	const msg = reason instanceof Error ? reason.message : String(reason);
	showToast(`操作失败: ${msg}`, "error");
});

export function getMainContent(): HTMLElement {
	return document.getElementById("main-content")!;
}

export function setMainContent(html: string) {
	getMainContent().innerHTML = html;
}

export function rpc() {
	return electrobun.rpc!;
}

// ---- Clipboard ----

/**
 * Copy text to the clipboard with a fallback chain:
 * async Clipboard API -> hidden-textarea execCommand.
 * Returns true on success.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
	try {
		if (navigator.clipboard && window.isSecureContext) {
			await navigator.clipboard.writeText(text);
			return true;
		}
	} catch {
		// fall through to legacy path
	}
	try {
		const ta = document.createElement("textarea");
		ta.value = text;
		ta.style.position = "fixed";
		ta.style.opacity = "0";
		ta.style.pointerEvents = "none";
		document.body.appendChild(ta);
		ta.focus();
		ta.select();
		const ok = document.execCommand("copy");
		ta.remove();
		return ok;
	} catch {
		return false;
	}
}

// Copy-use debounce: rapid repeated copies of the same prompt count as ONE use
const lastUseRecord = new Map<number, number>();
const USE_DEBOUNCE_MS = 1200;

/** Copy a prompt's raw content and record a use event (debounced). */
export async function copyPromptAndRecord(prompt: { id: number; content: string }): Promise<boolean> {
	const ok = await copyTextToClipboard(prompt.content);
	if (ok) {
		const now = Date.now();
		if (now - (lastUseRecord.get(prompt.id) ?? 0) > USE_DEBOUNCE_MS) {
			lastUseRecord.set(prompt.id, now);
			rpc()
				.request.recordPromptUse({ id: prompt.id })
				.catch(() => {});
		}
	}
	return ok;
}

// ---- Apple-style confirm dialog (replaces native confirm()) ----

export type ConfirmOptions = {
	title: string;
	message?: string;
	confirmText?: string;
	cancelText?: string;
	danger?: boolean;
};

/**
 * Show a macOS/iOS-style alert and resolve with the user's choice.
 * Buttons are stacked vertically; the cancel action is default-focused.
 */
export function showConfirm(opts: ConfirmOptions): Promise<boolean> {
	return new Promise((resolve) => {
		// Mutex: never stack confirm dialogs (e.g. double-click on a delete button)
		if (document.querySelector(".confirm-overlay")) {
			resolve(false);
			return;
		}
		const overlay = document.createElement("div");
		overlay.className = "modal-overlay confirm-overlay";
		overlay.innerHTML = `
			<div class="confirm-dialog" role="alertdialog" aria-modal="true">
				<div class="confirm-body">
					<h3 class="confirm-title">${escapeHtml(opts.title)}</h3>
					${opts.message ? `<p class="confirm-message">${escapeHtml(opts.message)}</p>` : ""}
				</div>
				<div class="confirm-actions">
					<button class="confirm-btn confirm-cancel">${escapeHtml(opts.cancelText ?? "取消")}</button>
					<button class="confirm-btn ${opts.danger ? "confirm-danger" : "confirm-primary"}">${escapeHtml(opts.confirmText ?? "确定")}</button>
				</div>
			</div>
		`;
		document.body.appendChild(overlay);

		const done = (result: boolean) => {
			overlay.remove();
			document.removeEventListener("keydown", onKey, true);
			resolve(result);
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.stopPropagation();
				done(false);
			} else if (e.key === "Enter") {
				// Enter activates the focused button (cancel by default — the safe
				// choice for destructive dialogs); with no button focused, cancels.
				e.stopPropagation();
				const focused = overlay.querySelector<HTMLElement>(".confirm-btn:focus");
				if (focused) focused.click();
				else done(false);
			}
		};
		document.addEventListener("keydown", onKey, true);

		overlay.querySelector(".confirm-cancel")!.addEventListener("click", () => done(false));
		overlay.querySelector(".confirm-danger, .confirm-primary")!.addEventListener("click", () => done(true));
		// Clicking the backdrop cancels
		overlay.addEventListener("click", (e) => {
			if (e.target === overlay) done(false);
		});
		// Focus cancel by default (safe choice)
		(overlay.querySelector(".confirm-cancel") as HTMLElement).focus();
	});
}

// ---- Window Controls ----
export async function windowMinimize() {
	await electrobun.rpc!.request.windowMinimize({});
}

export async function windowMaximize() {
	await electrobun.rpc!.request.windowMaximize({});
}

export async function windowClose() {
	await electrobun.rpc!.request.windowClose({});
}

export async function windowIsMaximized(): Promise<boolean> {
	return await electrobun.rpc!.request.windowIsMaximized({});
}

export async function windowGetPosition(): Promise<{ x: number; y: number }> {
	return await electrobun.rpc!.request.windowGetPosition({});
}

export async function windowSetPosition(x: number, y: number) {
	await electrobun.rpc!.request.windowSetPosition({ x, y });
}
