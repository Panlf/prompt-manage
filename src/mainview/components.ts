import { state, escapeHtml, formatDate, showToast, rpc, copyPromptAndRecord, openPrompt, rerender } from "./core";
import type { Prompt, PromptWithScenario } from "../shared/types";

// ---- SVG icons ----

export const ICONS = {
	star: (filled: boolean) => `
		<svg class="star-icon${filled ? " filled" : ""}" viewBox="0 0 16 16" fill="${filled ? "currentColor" : "none"}" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round">
			<path d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6L8 1.8z"/>
		</svg>
	`,
	copy: `<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><rect x="4.5" y="4.5" width="8" height="8" rx="1.5"/><path d="M9.5 4.5V3a1.5 1.5 0 00-1.5-1.5H3A1.5 1.5 0 001.5 3v5A1.5 1.5 0 003 9.5h1.5"/></svg>`,
	check: `<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 7.5l3 3 6-7"/></svg>`,
	variable: `<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M4 3.5C2.5 3.5 2.5 7 4 7s2-1 2-2M6 10.5c-1.5 0-1.5-3.5 0-3.5M8 3.5C9.5 3.5 9.5 7 8 7s-2-1-2-2M8 10.5c1.5 0 1.5-3.5 0-3.5"/></svg>`,
	// Dashboard stat icons
	grid: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7.5" height="7.5" rx="1.8"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.8"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.8"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.8"/></svg>`,
	doc: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/><path d="M10.5 13h7M10.5 17h4.5"/></svg>`,
	arrowUp: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M12 5l-6 6M12 5l6 6"/></svg>`,
	trash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2M6.5 7l1 13h9l1-13M10 11v6M14 11v6"/></svg>`,
	search: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/></svg>`,
};

// ---- Copy chip ----

// Prompt contents keyed by id — avoids stuffing full prompt text into DOM attributes
const promptContentCache = new Map<number, string>();

export function cachePromptContent(p: { id: number; content: string }) {
	if (promptContentCache.size > 500) promptContentCache.clear();
	promptContentCache.set(p.id, p.content);
}

/**
 * Wire every element with [data-copy-prompt] to copy its prompt and show
 * a transient success state on the chip itself.
 */
export function bindCopyButtons(root: ParentNode) {
	root.querySelectorAll<HTMLElement>("[data-copy-prompt]").forEach((btn) => {
		btn.addEventListener("click", async (e) => {
			e.stopPropagation();
			const id = parseInt(btn.dataset["copyPrompt"]!);
			const content = promptContentCache.get(id) ?? btn.dataset["content"] ?? "";
			const ok = await copyPromptAndRecord({ id, content });
			if (!ok) {
				showToast("复制失败，请重试", "error");
				return;
			}
			showToast("已复制到剪贴板", "success");
			const label = btn.querySelector(".copy-label");
			if (label) {
				const original = label.textContent;
				btn.classList.add("copied");
				label.textContent = "已复制";
				setTimeout(() => {
					btn.classList.remove("copied");
					label.textContent = original;
				}, 1500);
			}
		});
	});
}

// ---- Favorite star ----

/** Wire favorite toggle stars. Rerenders the current view if `refresh` is true. */
export function bindFavoriteStars(root: ParentNode, refresh = true) {
	root.querySelectorAll<HTMLElement>("[data-fav-prompt]").forEach((star) => {
		star.addEventListener("click", async (e) => {
			e.stopPropagation();
			const id = parseInt(star.dataset["favPrompt"]!);
			try {
				const updated = await rpc().request.togglePromptFavorite({ id });
				// Update star in place (no full rerender) for instant feedback
				const all = document.querySelectorAll<HTMLElement>(`[data-fav-prompt="${id}"]`);
				all.forEach((el) => {
					el.classList.toggle("active", !!updated.is_favorite);
					const svg = el.querySelector(".star-icon");
					if (svg) {
						svg.classList.toggle("filled", !!updated.is_favorite);
						svg.setAttribute("fill", updated.is_favorite ? "currentColor" : "none");
					}
				});
				showToast(updated.is_favorite ? "已收藏" : "已取消收藏", "success");
				if (refresh) {
					// Favorites/all-prompts views need list refresh (item may leave the list)
					if (state.view === "favorites") rerender();
				}
			} catch (err) {
				showToast("操作失败: " + (err instanceof Error ? err.message : String(err)), "error");
			}
		});
	});
}

// ---- Cross-scenario prompt row (all-prompts / favorites / dashboard) ----

export function promptRowHtml(p: PromptWithScenario, opts?: { showFavorite?: boolean; showScenario?: boolean }): string {
	const showFavorite = opts?.showFavorite ?? true;
	const showScenario = opts?.showScenario ?? true;
	cachePromptContent(p);
	const varCount = (p.content.match(/\{\{[^{}]*\}\}/g) || []).length;
	const tagsHtml =
		p.tags && p.tags.length > 0
			? `<span class="prompt-row-tags">${p.tags.map((t) => `<span class="tag-mini">${escapeHtml(t)}</span>`).join("")}</span>`
			: "";
	return `
		<div class="prompt-row" data-id="${p.id}" data-scenario-id="${p.scenario_id}">
			<div class="prompt-row-main">
				${showFavorite ? `<button class="fav-star${p.is_favorite ? " active" : ""}" data-fav-prompt="${p.id}" title="${p.is_favorite ? "取消收藏" : "收藏"}">${ICONS.star(!!p.is_favorite)}</button>` : ""}
				<div class="prompt-row-text">
					<div class="prompt-row-title">
						<span class="prompt-row-name">${escapeHtml(p.title)}</span>
						${varCount > 0 ? `<span class="var-badge" title="包含 ${varCount} 个变量">${ICONS.variable}${varCount}</span>` : ""}
						${p.source === "ai" ? '<span class="source-badge source-ai">AI</span>' : ""}
						${tagsHtml}
					</div>
					<p class="prompt-row-preview">${escapeHtml(p.content)}</p>
				</div>
			</div>
			<div class="prompt-row-side">
				${showScenario ? `<span class="prompt-row-scenario">${escapeHtml(p.scenario_name)}</span>` : ""}
				<span class="prompt-row-uses">${p.use_count > 0 ? `↑ ${p.use_count} 次` : "未使用"}</span>
				<span class="prompt-row-date">${formatDate(p.last_used_at || p.updated_at)}</span>
				<button class="copy-chip" data-copy-prompt="${p.id}" title="复制提示词">
					<span class="copy-icon">${ICONS.copy}</span>
					<span class="copy-label">复制</span>
				</button>
			</div>
		</div>
	`;
}

/** Wire prompt rows: click opens detail; copy + favorite chips handled globally. */
export function bindPromptRows(root: ParentNode, origin: "all-prompts" | "favorites" | "dashboard") {
	root.querySelectorAll<HTMLElement>(".prompt-row").forEach((row) => {
		row.addEventListener("click", (e) => {
			if ((e.target as HTMLElement).closest("button")) return;
			const id = parseInt(row.dataset["id"]!);
			const scenarioId = parseInt(row.dataset["scenarioId"]!);
			openPrompt(id, scenarioId, origin);
		});
	});
	bindCopyButtons(root);
	bindFavoriteStars(root);
}

// ---- Prompt card (scenario detail list) ----

export function promptCardHtml(p: Prompt): string {
	cachePromptContent(p);
	const varCount = (p.content.match(/\{\{[^{}]*\}\}/g) || []).length;
	const tagsHtml =
		p.tags && p.tags.length > 0
			? `<div class="card-tags prompt-card-tags">${p.tags.map((t) => `<span class="tag-mini">${escapeHtml(t)}</span>`).join("")}</div>`
			: "";
	return `
		<div class="card prompt-card" data-id="${p.id}">
			<div class="card-header">
				<h3 class="card-title">
					<button class="fav-star${p.is_favorite ? " active" : ""}" data-fav-prompt="${p.id}" title="${p.is_favorite ? "取消收藏" : "收藏"}">${ICONS.star(!!p.is_favorite)}</button>
					${escapeHtml(p.title)}
					${p.source === "ai" ? '<span class="source-badge source-ai">AI</span>' : '<span class="source-badge source-manual">手动</span>'}
					${varCount > 0 ? `<span class="var-badge" title="包含 ${varCount} 个变量">${ICONS.variable}${varCount}</span>` : ""}
				</h3>
				<div class="card-actions">
					<button class="copy-chip" data-copy-prompt="${p.id}" title="复制提示词">
						<span class="copy-icon">${ICONS.copy}</span>
						<span class="copy-label">复制</span>
					</button>
					<span class="card-meta">${formatDate(p.updated_at)}</span>
				</div>
			</div>
			<p class="prompt-preview">${escapeHtml(p.content)}</p>
			${tagsHtml}
			<div class="prompt-card-meta">
				${p.model_name ? `<span class="card-meta">模型: ${escapeHtml(p.model_name)}</span>` : ""}
				<span class="card-meta">${p.use_count > 0 ? `已使用 ${p.use_count} 次` : "未使用"}</span>
				${p.last_used_at ? `<span class="card-meta">最近使用 ${formatDate(p.last_used_at)}</span>` : ""}
			</div>
		</div>
	`;
}
