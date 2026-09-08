import { state, setMainContent, navigate, rpc, type ViewName } from "./core";
import { promptRowHtml, bindPromptRows, ICONS } from "./components";
import type { DashboardStats, PromptWithScenario } from "../shared/types";

export async function renderDashboard() {
	const [stats, recent, favorites] = await Promise.all([
		rpc().request.getDashboardStats({}),
		rpc().request.getRecentPrompts({ limit: 8 }),
		rpc().request.getFavoritePrompts({}),
	]);
	if (state.view !== "dashboard") return; // user navigated away while loading

	const isEmpty = stats.scenario_count === 0;
	const modKey = navigator.platform.toUpperCase().includes("MAC") ? "⌘K" : "Ctrl+K";

	setMainContent(`
		<div class="page-header">
			<h2>总览</h2>
			<button class="btn-primary" id="dash-new-scenario">新建场景</button>
		</div>
		${
			isEmpty
				? `<div class="empty-state">
						<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="6" width="9" height="9" rx="2"/><rect x="17" y="6" width="9" height="9" rx="2"/><rect x="6" y="17" width="9" height="9" rx="2"/><rect x="17" y="17" width="9" height="9" rx="2"/></svg>
						欢迎使用提示词管理<br/>
						<span class="empty-hint">创建你的第一个使用场景，开始整理提示词。按 ${modKey} 可随时全局搜索。</span>
						<button class="btn-primary" id="dash-new-scenario-2">新建场景</button>
					</div>`
				: renderDashboardBody(stats, recent, favorites.slice(0, 6))
		}
	`);

	const goNewScenario = () => {
		navigate("scenarios");
		// Open the create modal on the scenarios page after it renders
		setTimeout(() => document.getElementById("new-scenario-btn")?.click(), 50);
	};
	document.getElementById("dash-new-scenario")?.addEventListener("click", goNewScenario);
	document.getElementById("dash-new-scenario-2")?.addEventListener("click", goNewScenario);

	if (!isEmpty) {
		bindPromptRows(document.getElementById("dash-recent")!, "dashboard");
		bindPromptRows(document.getElementById("dash-favorites")!, "dashboard");
		bindGoto(document);
	}
}

function renderDashboardBody(stats: DashboardStats, recent: PromptWithScenario[], favorites: PromptWithScenario[]): string {
	const cards: { label: string; value: number; cls: string; icon: string; view: ViewName }[] = [
		{ label: "使用场景", value: stats.scenario_count, cls: "stat-blue", icon: ICONS.grid, view: "scenarios" },
		{ label: "提示词", value: stats.prompt_count, cls: "stat-purple", icon: ICONS.doc, view: "all-prompts" },
		{ label: "收藏", value: stats.favorite_count, cls: "stat-orange", icon: ICONS.star(false), view: "favorites" },
		{ label: "累计使用", value: stats.total_uses, cls: "stat-green", icon: ICONS.arrowUp, view: "all-prompts" },
	];

	return `
		<div class="stat-grid">
			${cards
				.map(
					(c) => `
				<div class="stat-card ${c.cls}" data-goto="${c.view}" role="button" tabindex="0">
					<div class="stat-icon">${c.icon}</div>
					<div class="stat-value">${c.value}</div>
					<div class="stat-label">${c.label}</div>
				</div>
			`,
				)
				.join("")}
		</div>

		<div class="dash-columns">
			<div class="dash-panel">
				<div class="dash-panel-header">
					<h3>最近使用</h3>
					<button class="btn-link" data-goto="all-prompts">查看全部</button>
				</div>
				<div id="dash-recent" class="prompt-row-list">
					${
						recent.length > 0
							? recent.map((p) => promptRowHtml(p)).join("")
							: '<div class="empty-state-small">还没有使用记录，点击提示词上的"复制"即记为一次使用</div>'
					}
				</div>
			</div>

			<div class="dash-panel">
				<div class="dash-panel-header">
					<h3>我的收藏</h3>
					<button class="btn-link" data-goto="favorites">查看全部</button>
				</div>
				<div id="dash-favorites" class="prompt-row-list">
					${
						favorites.length > 0
							? favorites.map((p) => promptRowHtml(p)).join("")
							: '<div class="empty-state-small">点击提示词标题旁的星形图标即可收藏</div>'
					}
				</div>
			</div>
		</div>
	`;
}

/** Wire stat-card / btn-link navigation. */
export function bindGoto(root: ParentNode) {
	root.querySelectorAll<HTMLElement>("[data-goto]").forEach((el) => {
		el.addEventListener("click", () => {
			navigate(el.dataset["goto"] as ViewName);
		});
	});
}
