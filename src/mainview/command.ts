import { rpc, escapeHtml, highlightHtml, openPrompt, navigate } from "./core";
import { ICONS } from "./components";
import type { SearchResults, PromptWithScenario } from "../shared/types";

// ---- Command palette (Ctrl/Cmd+K) ----

let paletteEl: HTMLElement | null = null;
let searchInput: HTMLInputElement | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let results: SearchResults = { scenarios: [], prompts: [] };
let recents: PromptWithScenario[] = [];
let selectedIndex = 0;

type PaletteItem = {
	kind: "scenario" | "prompt";
	id: number;
	scenarioId: number;
	title: string;
	subtitle: string;
};

export function isPaletteOpen(): boolean {
	return paletteEl !== null;
}

export function openPalette() {
	if (paletteEl) return;
	recents = [];
	buildPalette();
	refresh(""); // prime with recents
}

export function closePalette() {
	if (debounceTimer) clearTimeout(debounceTimer);
	paletteEl?.remove();
	paletteEl = null;
	searchInput = null;
}

function buildPalette() {
	const overlay = document.createElement("div");
	overlay.className = "cmdk-overlay";
	overlay.innerHTML = `
		<div class="cmdk" role="dialog" aria-modal="true">
			<div class="cmdk-input-row">
				<span class="cmdk-search-icon">${ICONS.search}</span>
				<input type="text" class="cmdk-input" placeholder="搜索场景、提示词或标签…" />
				<span class="cmdk-esc">esc</span>
			</div>
			<div class="cmdk-results" id="cmdk-results"></div>
			<div class="cmdk-footer">
				<span><kbd>↑</kbd><kbd>↓</kbd> 选择</span>
				<span><kbd>↵</kbd> 打开</span>
				<span><kbd>esc</kbd> 关闭</span>
			</div>
		</div>
	`;
	document.body.appendChild(overlay);
	paletteEl = overlay;
	searchInput = overlay.querySelector(".cmdk-input");

	// Prime recents lazily
	rpc()
		.request.getRecentPrompts({ limit: 5 })
		.then((r) => {
			recents = r;
			if (searchInput && !searchInput.value) renderResults();
		})
		.catch(() => {});

	searchInput!.addEventListener("input", () => {
		if (debounceTimer) clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => refresh(searchInput!.value), 150);
	});
	searchInput!.addEventListener("keydown", (e) => {
		if (e.key === "ArrowDown") {
			e.preventDefault();
			moveSelection(1);
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			moveSelection(-1);
		} else if (e.key === "Enter") {
			e.preventDefault();
			chooseSelected();
		} else if (e.key === "Escape") {
			e.preventDefault();
			closePalette();
		}
	});
	overlay.addEventListener("mousedown", (e) => {
		if (e.target === overlay) closePalette();
	});

	setTimeout(() => searchInput?.focus(), 0);
}

async function refresh(query: string) {
	selectedIndex = 0;
	if (!query.trim()) {
		results = { scenarios: [], prompts: [] };
		renderResults();
		return;
	}
	try {
		results = await rpc().request.searchAll({ query });
	} catch {
		results = { scenarios: [], prompts: [] };
	}
	renderResults(query.trim());
}

function currentItems(): PaletteItem[] {
	const items: PaletteItem[] = [];
	for (const s of results.scenarios) {
		items.push({ kind: "scenario", id: s.id, scenarioId: s.id, title: s.name, subtitle: s.description || `${s.prompt_count} 个提示词` });
	}
	for (const p of results.prompts) {
		items.push({ kind: "prompt", id: p.id, scenarioId: p.scenario_id, title: p.title, subtitle: p.scenario_name });
	}
	return items;
}

function renderResults(query = "") {
	const container = paletteEl?.querySelector("#cmdk-results");
	if (!container) return;

	const items = currentItems();

	// Empty query -> show recents
	if (!query) {
		if (recents.length === 0) {
			container.innerHTML = `<div class="cmdk-empty">输入关键词搜索全部场景与提示词</div>`;
			return;
		}
		container.innerHTML = `
			<div class="cmdk-group-label">最近使用</div>
			${recents.map((p, i) => rowHtml("prompt", p.id, p.scenario_id, p.title, p.scenario_name, "", i)).join("")}
		`;
		selectedIndex = 0;
		bindRows(container, true);
		return;
	}

	if (items.length === 0) {
		container.innerHTML = `<div class="cmdk-empty">没有找到匹配"${escapeHtml(query)}"的内容</div>`;
		return;
	}

	let html = "";
	if (results.scenarios.length > 0) {
		html += `<div class="cmdk-group-label">使用场景</div>`;
		html += results.scenarios.map((s, i) => rowHtml("scenario", s.id, s.id, s.name, s.description || `${s.prompt_count} 个提示词`, query, i)).join("");
	}
	if (results.prompts.length > 0) {
		html += `<div class="cmdk-group-label">提示词</div>`;
		html += results.prompts
			.map((p, i) => rowHtml("prompt", p.id, p.scenario_id, p.title, p.scenario_name, query, results.scenarios.length + i))
			.join("");
	}
	container.innerHTML = html;
	bindRows(container, false);
}

function rowHtml(
	kind: "scenario" | "prompt",
	id: number,
	scenarioId: number,
	title: string,
	subtitle: string,
	query: string,
	index: number,
): string {
	const icon = kind === "scenario" ? ICONS.grid : ICONS.doc;
	return `
		<div class="cmdk-row${index === selectedIndex ? " selected" : ""}" data-kind="${kind}" data-id="${id}" data-scenario-id="${scenarioId}" data-index="${index}">
			<span class="cmdk-row-icon">${icon}</span>
			<span class="cmdk-row-title">${highlightHtml(title, query)}</span>
			<span class="cmdk-row-sub">${escapeHtml(subtitle)}</span>
		</div>
	`;
}

function bindRows(container: Element, isRecent: boolean) {
	container.querySelectorAll<HTMLElement>(".cmdk-row").forEach((row) => {
		row.addEventListener("click", () => {
			selectedIndex = parseInt(row.dataset["index"]!);
			chooseSelected(isRecent);
		});
		row.addEventListener("mousemove", () => {
			const idx = parseInt(row.dataset["index"]!);
			if (idx !== selectedIndex) {
				selectedIndex = idx;
				updateSelectionClasses();
			}
		});
	});
}

function moveSelection(delta: number) {
	const items = paletteEl?.querySelectorAll(".cmdk-row");
	if (!items || items.length === 0) return;
	selectedIndex = (selectedIndex + delta + items.length) % items.length;
	updateSelectionClasses();
	const el = items[selectedIndex] as HTMLElement;
	el.scrollIntoView({ block: "nearest" });
}

function updateSelectionClasses() {
	paletteEl?.querySelectorAll<HTMLElement>(".cmdk-row").forEach((row) => {
		row.classList.toggle("selected", parseInt(row.dataset["index"]!) === selectedIndex);
	});
}

function chooseSelected(isRecent = false) {
	const rows = paletteEl?.querySelectorAll<HTMLElement>(".cmdk-row");
	if (!rows || rows.length === 0) return;
	const row = rows[selectedIndex] ?? (rows[0] as HTMLElement);
	const kind = row.dataset["kind"] as "scenario" | "prompt";
	const id = parseInt(row.dataset["id"]!);
	const scenarioId = parseInt(row.dataset["scenarioId"]!);
	closePalette();
	if (kind === "scenario") {
		navigate("scenario-detail", id);
	} else {
		// Recents open back into the all-prompts view; search results keep the scenario origin
		if (isRecent) openPrompt(id, scenarioId, "all-prompts");
		else openPrompt(id, scenarioId, "scenarios");
	}
}

// ---- Global shortcut wiring (called from index.ts) ----

export function initCommandPalette() {
	document.addEventListener("keydown", (e) => {
		// A confirm dialog or business modal owns the keyboard while open —
		// don't layer the palette on top
		if (document.querySelector(".confirm-overlay, .modal-overlay")) return;
		const mod = e.ctrlKey || e.metaKey;
		if (mod && e.key.toLowerCase() === "k") {
			e.preventDefault();
			if (isPaletteOpen()) closePalette();
			else openPalette();
		} else if (e.key === "Escape" && isPaletteOpen()) {
			closePalette();
		}
	});
}
