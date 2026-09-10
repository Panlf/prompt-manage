import { state, setMainContent, rpc, showToast, escapeHtml } from "./core";
import { promptRowHtml, bindPromptRows } from "./components";
import type { PromptWithScenario, PromptSort, Tag } from "../shared/types";

const SORT_LABELS: { key: PromptSort; label: string }[] = [
	{ key: "updated", label: "最近更新" },
	{ key: "recent", label: "最近使用" },
	{ key: "most_used", label: "最常用" },
];

// Toolbar state, persisted across page entries
let lastSort: PromptSort = "updated";
let lastSource = "";
let lastTag = "";
let lastFavorite = false;
// Incremented on every toolbar change / page exit; stale async list refreshes
// are dropped by comparing tokens (prevents flicker from out-of-order responses)
let refreshToken = 0;

async function loadPromptTags(): Promise<Tag[]> {
	try {
		return await rpc().request.getAllPromptTags({});
	} catch {
		return [];
	}
}

/**
 * The "全部提示词" view. The page shell (header/toolbar) renders once per
 * entry; sort & filter changes only refresh the list region in place — no
 * full-page re-render, no flicker.
 */
export async function renderAllPrompts() {
	refreshToken++;
	const promptTags = await loadPromptTags();
	if (state.view !== "all-prompts") return; // user navigated away while loading

	setMainContent(`
		<div class="page-header">
			<h2>全部提示词</h2>
			<span class="page-count" id="all-count"></span>
		</div>
		<div class="list-toolbar">
			<div class="segmented" id="sort-seg">
				${SORT_LABELS.map((s) => `<button class="seg-btn${lastSort === s.key ? " active" : ""}" data-sort="${s.key}">${s.label}</button>`).join("")}
			</div>
			<div class="filter-pills" id="source-pills">
				<button class="tag-pill${lastSource === "" ? " active" : ""}" data-source="">全部来源</button>
				<button class="tag-pill${lastSource === "ai" ? " active" : ""}" data-source="ai">AI 生成</button>
				<button class="tag-pill${lastSource === "manual" ? " active" : ""}" data-source="manual">手动</button>
				<button class="tag-pill${lastFavorite ? " active" : ""}" id="fav-filter" title="只显示收藏的提示词">⭐ 仅收藏</button>
			</div>
		</div>
			${
				promptTags.length > 0
					? `<div class="filter-pills tag-filter-row" id="tag-pills">
				<button class="tag-pill${lastTag === "" ? " active" : ""}" data-tag="">全部标签</button>
				${promptTags
					.map(
						(t) =>
							`<button class="tag-pill${lastTag === t.name ? " active" : ""}" data-tag="${escapeHtml(t.name)}">${escapeHtml(t.name)}<span class="tag-count">${t.count}</span></button>`,
					)
					.join("")}
			</div>`
				: ""
		}
		<div class="prompt-row-list card" id="all-prompt-list">
			<div class="empty-state" style="border:none;background:transparent">加载中…</div>
		</div>
	`);

	bindToolbar();
	await refreshList();
}

/** Fetch the list with current toolbar state and swap it in (list region only). */
async function refreshList() {
	const token = ++refreshToken;
	const listEl = document.getElementById("all-prompt-list");
	if (!listEl) return; // user already navigated away
	listEl.classList.add("refreshing");

	let prompts: PromptWithScenario[] = [];
	try {
		prompts = await rpc().request.getAllPrompts({
			sort: lastSort,
			favorite: lastFavorite || undefined,
			source: lastSource || undefined,
			tag: lastTag || undefined,
		});
	} catch (err) {
		showToast("加载失败: " + (err instanceof Error ? err.message : String(err)), "error");
	}
	if (token !== refreshToken) return; // a newer refresh superseded this one

	listEl.innerHTML =
		prompts.length > 0
			? prompts.map((p) => promptRowHtml(p)).join("")
			: `<div class="empty-state" style="border:none;background:transparent">没有符合条件的提示词</div>`;
	bindPromptRows(listEl, "all-prompts");

	const countEl = document.getElementById("all-count");
	if (countEl) countEl.textContent = `${prompts.length} 条`;

	// Let the fade-in transition start from the dimmed state
	requestAnimationFrame(() => listEl.classList.remove("refreshing"));
}

/** Wire the toolbar: toggles update state in place, then refresh only the list. */
function bindToolbar() {
	document.querySelectorAll<HTMLButtonElement>("#sort-seg .seg-btn").forEach((btn) => {
		btn.addEventListener("click", () => {
			if (lastSort === btn.dataset["sort"]) return;
			lastSort = btn.dataset["sort"] as PromptSort;
			document.querySelectorAll("#sort-seg .seg-btn").forEach((b) => b.classList.toggle("active", b === btn));
			refreshList();
		});
	});
	document.querySelectorAll<HTMLButtonElement>("#source-pills .tag-pill").forEach((btn) => {
		btn.addEventListener("click", () => {
			const value = btn.dataset["source"] || "";
			if (lastSource === value) return;
			lastSource = value;
			document.querySelectorAll("#source-pills .tag-pill").forEach((b) => b.classList.toggle("active", b === btn));
			refreshList();
		});
	});
	document.querySelectorAll<HTMLButtonElement>("#tag-pills .tag-pill").forEach((btn) => {
		btn.addEventListener("click", () => {
			const value = btn.dataset["tag"] || "";
			if (lastTag === value) return;
			lastTag = value;
			document.querySelectorAll("#tag-pills .tag-pill").forEach((b) => b.classList.toggle("active", b === btn));
			refreshList();
		});
	});
	document.getElementById("fav-filter")?.addEventListener("click", () => {
		lastFavorite = !lastFavorite;
		document.getElementById("fav-filter")?.classList.toggle("active", lastFavorite);
		refreshList();
	});
}

/** The "收藏" view: favorites sorted by recent use. */
export async function renderFavorites() {
	refreshToken++;
	const prompts = await rpc().request.getFavoritePrompts({});
	if (state.view !== "favorites") return; // user navigated away while loading

	setMainContent(`
		<div class="page-header">
			<h2>收藏</h2>
			<span class="page-count">${prompts.length} 条</span>
		</div>
		<p class="page-desc">按最近使用排序。点击提示词上的星形图标可取消收藏。</p>
		<div class="prompt-row-list card" id="fav-list">
			${
				prompts.length > 0
					? prompts.map((p) => promptRowHtml(p)).join("")
					: `<div class="empty-state" style="border:none;background:transparent">
							<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M16 4.5l3.8 7.8 8.6 1.2-6.2 6 1.5 8.6L16 24l-7.7 4.1 1.5-8.6-6.2-6 8.6-1.2L16 4.5z"/></svg>
							还没有收藏的提示词<br/><span class="empty-hint">在任意提示词上点击星形图标即可收藏到这里</span>
						</div>`
			}
		</div>
	`);

	bindPromptRows(document.getElementById("fav-list")!, "favorites");
}
