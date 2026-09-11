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
let lastTag = "";
let lastFavorite = false;
// Incremented on every toolbar change / page exit; stale async loads
// are dropped by comparing tokens (prevents flicker / wrong-page appends)
let refreshToken = 0;

// ---- 懒加载分页：首屏 PAGE_SIZE 条，滚动接近底部自动续载 ----
const PAGE_SIZE = 6;
// 触底阈值：距滚动容器底部不足该距离时续载
const LOAD_MORE_THRESHOLD = 60;
// 两次续载之间的冷却：同一滚动手势/惯性内不连续翻页（一次滚动 ≈ 一页）
const LOAD_COOLDOWN_MS = 500;
// 当前筛选条件下已加载的条目（滚动追加；筛选/排序变化时重置）
let pageItems: PromptWithScenario[] = [];
// 当前筛选条件下匹配的总条数（页头计数展示，与已加载条数无关）
let totalCount = 0;
// 当前在途加载的 token；null = 无在途加载（防止滚动重复触发）
let activeLoad: number | null = null;
// 冷却截止时间：续载后短时间内忽略再次触发
let cooldownUntil = 0;

// 收藏状态变化时，若"仅收藏"筛选开启则重载列表（取消收藏的行需要移出列表，
// 新收藏的行需要按当前排序进入列表）。事件由 components.ts 的收藏星广播。
document.addEventListener("prompt-favorite-changed", () => {
	if (state.view === "all-prompts" && lastFavorite) loadPage(0, false);
});

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
	pageItems = [];
	totalCount = 0;
	disconnectListObserver();
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
			<div class="filter-pills">
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
		<div class="list-footer" id="list-footer"></div>
	`);

	bindToolbar();
	setupListObserver();
	await loadPage(0, false);
}

/**
 * Load one page (自 offset 起 PAGE_SIZE 条) with current toolbar state.
 * append=false：替换整个列表（进入页面/筛选排序变化）；append=true：滚动追加。
 * 页头计数始终展示 totalCount（筛选匹配总条数），与已加载条数无关。
 */
async function loadPage(offset: number, append: boolean) {
	const token = ++refreshToken;
	activeLoad = token;
	const footer = document.getElementById("list-footer");
	if (footer) footer.textContent = "加载中…";
	const listEl = document.getElementById("all-prompt-list");
	if (!append && listEl) listEl.classList.add("refreshing");

	let res: { items: PromptWithScenario[]; total: number };
	try {
		res = await rpc().request.getAllPrompts({
			sort: lastSort,
			favorite: lastFavorite || undefined,
			tag: lastTag || undefined,
			limit: PAGE_SIZE,
			offset,
		});
	} catch (err) {
		if (token !== refreshToken) return; // superseded
		activeLoad = null;
		if (footer) footer.textContent = "加载失败，2 秒后自动重试";
		showToast("加载失败: " + (err instanceof Error ? err.message : String(err)), "error");
		// 延迟自动重试同一页：仍在当前视图且筛选/页面未变时才重试
		// （持续失败则每 2s 重试一次；筛选切换/离开页面即放弃）
		setTimeout(() => {
			if (state.view !== "all-prompts") return;
			if (token !== refreshToken) return; // 筛选或页面已变化
			if (activeLoad === null && nearBottom()) void loadPage(offset, append);
		}, 2000);
		return;
	}
	if (token !== refreshToken) return; // a newer load superseded this one

	totalCount = res.total;
	pageItems = append ? pageItems.concat(res.items) : res.items;

	const list = document.getElementById("all-prompt-list");
	if (!list) return; // user already navigated away

	if (append) {
		if (res.items.length > 0) {
			// 在临时容器内完成事件绑定后再搬入列表，避免对既有行重复绑定
			const temp = document.createElement("div");
			temp.innerHTML = res.items.map((p) => promptRowHtml(p)).join("");
			bindPromptRows(temp, "all-prompts");
			list.querySelector(".empty-state")?.remove();
			while (temp.firstChild) list.appendChild(temp.firstChild);
		}
	} else {
		list.innerHTML =
			pageItems.length > 0
				? pageItems.map((p) => promptRowHtml(p)).join("")
				: `<div class="empty-state" style="border:none;background:transparent">没有符合条件的提示词</div>`;
		bindPromptRows(list, "all-prompts");
		// Let the fade-in transition start from the dimmed state
		requestAnimationFrame(() => list.classList.remove("refreshing"));
	}

	const countEl = document.getElementById("all-count");
	if (countEl) countEl.textContent = `${totalCount} 条`;

	if (footer) {
		footer.textContent =
			totalCount === 0
				? ""
				: pageItems.length >= totalCount
					? "已全部加载"
					: `已显示 ${pageItems.length} / ${totalCount} 条，继续滚动加载更多`;
	}
	activeLoad = null;
	// 不做自动补齐：是否续载完全由用户的滚动/滚轮动作驱动（onRootScroll / onRootWheel）
}

function maybeLoadMore() {
	if (activeLoad !== null) return; // 已有在途加载
	if (Date.now() < cooldownUntil) return; // 冷却期内：一次滚动手势只翻一页
	if (state.view !== "all-prompts") return;
	if (pageItems.length >= totalCount) return; // 已全部加载
	if (!nearBottom()) return;
	cooldownUntil = Date.now() + LOAD_COOLDOWN_MS;
	void loadPage(pageItems.length, true);
}

function scrollRoot(): HTMLElement | null {
	return document.getElementById("main-content");
}

/** 是否接近底部（不足一屏时距离恒 ≤ 0，同样视为"到底"） */
function nearBottom(): boolean {
	const root = scrollRoot();
	if (!root) return false;
	return root.scrollHeight - root.scrollTop - root.clientHeight < LOAD_MORE_THRESHOLD;
}

function onRootScroll() {
	maybeLoadMore();
}

function onRootWheel(e: WheelEvent) {
	const root = scrollRoot();
	if (!root || e.deltaY <= 0) return; // 只有向下滚表示"想看更多"
	// 内容不足一屏时没有滚动条、不会产生 scroll 事件：用滚轮向下触发加载下一页
	// （冷却由 maybeLoadMore 统一控制）
	if (root.scrollHeight > root.clientHeight) return;
	maybeLoadMore();
}

function setupListObserver() {
	disconnectListObserver();
	const root = scrollRoot();
	if (!root) return;
	root.addEventListener("scroll", onRootScroll, { passive: true });
	root.addEventListener("wheel", onRootWheel, { passive: true });
	window.addEventListener("resize", onRootScroll);
}

function disconnectListObserver() {
	scrollRoot()?.removeEventListener("scroll", onRootScroll);
	scrollRoot()?.removeEventListener("wheel", onRootWheel);
	window.removeEventListener("resize", onRootScroll);
}

/** Wire the toolbar: toggles update state in place, then refresh only the list. */
function bindToolbar() {
	document.querySelectorAll<HTMLButtonElement>("#sort-seg .seg-btn").forEach((btn) => {
		btn.addEventListener("click", () => {
			if (lastSort === btn.dataset["sort"]) return;
			lastSort = btn.dataset["sort"] as PromptSort;
			document.querySelectorAll("#sort-seg .seg-btn").forEach((b) => b.classList.toggle("active", b === btn));
			loadPage(0, false);
		});
	});
	document.querySelectorAll<HTMLButtonElement>("#tag-pills .tag-pill").forEach((btn) => {
		btn.addEventListener("click", () => {
			const value = btn.dataset["tag"] || "";
			if (lastTag === value) return;
			lastTag = value;
			document.querySelectorAll("#tag-pills .tag-pill").forEach((b) => b.classList.toggle("active", b === btn));
			loadPage(0, false);
		});
	});
	document.getElementById("fav-filter")?.addEventListener("click", () => {
		lastFavorite = !lastFavorite;
		document.getElementById("fav-filter")?.classList.toggle("active", lastFavorite);
		loadPage(0, false);
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
