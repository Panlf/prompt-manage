import { state, setRenderFn, navigate, loadAll, setMainContent, escapeHtml, type ViewName, isMacPlatform, windowMinimize, windowSetMaximized, windowSyncInputRegion, windowClose, windowGetPosition, windowSetPosition, getUiPref, setUiPref } from "./core";
import { renderDashboard } from "./dashboard";
import { renderScenarios } from "./scenarios";
import { renderScenarioDetail, renderPromptDetail } from "./prompts";
import { renderAllPrompts, renderFavorites } from "./allprompts";
import { renderTrash } from "./trash";
import { renderSettings, renderDataManagement } from "./settings";
import { initCommandPalette, closePalette, openPalette } from "./command";

function initWindowControls() {
	const btnMin = document.getElementById("btn-minimize");
	const btnMax = document.getElementById("btn-maximize");
	const btnClose = document.getElementById("btn-close");
	const titleBar = document.getElementById("title-bar");
	const dragArea = titleBar?.querySelector(".title-bar-drag") as HTMLElement | null;

	// 最大化状态以视口尺寸实时推断（最大化 = 视口铺满屏幕工作区）。
	// 不依赖后端状态：按钮、双击标题栏、系统贴靠/Win+方向键触发的最大化都能被感知，
	// 避免状态标记与真实窗口状态脱节导致按钮失灵
	let maximized = false;
	const setMaxIcon = (isMax: boolean) => {
		const iconMax = btnMax?.querySelector(".icon-maximize") as HTMLElement | null;
		const iconRestore = btnMax?.querySelector(".icon-restore") as HTMLElement | null;
		if (iconMax && iconRestore) {
			iconMax.style.display = isMax ? "none" : "block";
			iconRestore.style.display = isMax ? "block" : "none";
		}
	};
	const refreshMaxState = () => {
		maximized = window.innerWidth >= screen.availWidth && window.innerHeight >= screen.availHeight;
		setMaxIcon(maximized);
	};
	window.addEventListener("resize", refreshMaxState);
	refreshMaxState();

	const toggleMaximize = async () => {
		maximized = !maximized;
		setMaxIcon(maximized); // resize 事件到达前先乐观更新图标，避免连点竞态
		await windowSetMaximized(maximized);
	};

	btnMin?.addEventListener("click", () => windowMinimize());
	btnMax?.addEventListener("click", toggleMaximize);
	btnClose?.addEventListener("click", () => windowClose());

	titleBar?.addEventListener("dblclick", async (e) => {
		if ((e.target as HTMLElement).closest(".window-btn")) return;
		if ((e.target as HTMLElement).closest("#theme-picker")) return;
		await toggleMaximize();
	});

	// ---- Manual pointer-based drag (works with native + CEF renderer) ----
	if (dragArea) {
		const DRAG_THRESHOLD = 3; // pixels — distinguish drag from click
		let dragState: {
			isDragging: boolean;
			startScreenX: number;
			startScreenY: number;
			winStartX: number;
			winStartY: number;
		} | null = null;
		let suppressNextClick = false;

		dragArea.addEventListener("pointerdown", async (e: PointerEvent) => {
			if (e.button !== 0) return; // only left mouse button
			if ((e.target as HTMLElement).closest(".window-btn")) return;
			// Don't drag if window is maximized
			if (maximized) return;

			const pos = await windowGetPosition();
			dragState = {
				isDragging: false,
				startScreenX: e.screenX,
				startScreenY: e.screenY,
				winStartX: pos.x,
				winStartY: pos.y,
			};
			dragArea.setPointerCapture(e.pointerId);
		});

		dragArea.addEventListener("pointermove", async (e: PointerEvent) => {
			if (!dragState) return;
			const dx = e.screenX - dragState.startScreenX;
			const dy = e.screenY - dragState.startScreenY;

			if (!dragState.isDragging) {
				// Check threshold to enter drag mode
				if (Math.hypot(dx, dy) >= DRAG_THRESHOLD) {
					dragState.isDragging = true;
					suppressNextClick = true;
				} else {
					return;
				}
			}

			// Drag mode: update window position
			const newX = dragState.winStartX + dx;
			const newY = dragState.winStartY + dy;
			// Fire-and-forget to avoid queue buildup; last value wins
			windowSetPosition(newX, newY);
		});

		const endDrag = (e: PointerEvent) => {
			if (dragState) {
				try { dragArea.releasePointerCapture(e.pointerId); } catch { /* noop */ }
				dragState = null;
			}
		};

		dragArea.addEventListener("pointerup", endDrag);
		dragArea.addEventListener("pointercancel", endDrag);

		// Suppress click event if drag occurred (avoids weird UI side effects)
		dragArea.addEventListener("click", (e) => {
			if (suppressNextClick) {
				suppressNextClick = false;
				e.stopPropagation();
				e.preventDefault();
			}
		}, true);
	}
}

// ---- Theme picker (页面配色) ----
const THEME_KEY = "theme";

function applyTheme(theme: string) {
	if (theme) document.documentElement.dataset["theme"] = theme;
	else delete document.documentElement.dataset["theme"];
	document.querySelectorAll<HTMLButtonElement>(".theme-option").forEach((opt) => {
		opt.classList.toggle("active", (opt.dataset["themeValue"] ?? "") === theme);
	});
}

async function initTheme() {
	try {
		const saved = await getUiPref(THEME_KEY);
		if (saved) applyTheme(saved);
	} catch {
		// 读取失败按默认配色显示
	}
}

function initThemePicker() {
	const picker = document.getElementById("theme-picker");
	const btn = document.getElementById("btn-theme");
	const menu = document.getElementById("theme-menu");
	if (!picker || !btn || !menu) return;

	btn.addEventListener("click", () => {
		menu.hidden = !menu.hidden;
	});

	menu.querySelectorAll<HTMLButtonElement>(".theme-option").forEach((opt) => {
		opt.addEventListener("click", async () => {
			const theme = opt.dataset["themeValue"] ?? "";
			applyTheme(theme);
			menu.hidden = true;
			try {
				await setUiPref(THEME_KEY, theme); // 存库，重启后保持
			} catch {
				// 保存失败时本次会话仍生效
			}
		});
	});

	// 点击选择器外部时收起菜单
	document.addEventListener("click", (e) => {
		if (!menu.hidden && !(e.target as HTMLElement).closest("#theme-picker")) {
			menu.hidden = true;
		}
	});
	document.addEventListener("keydown", (e) => {
		if (e.key === "Escape" && !menu.hidden) menu.hidden = true;
	});
}

function initSidebar() {
	const sidebar = document.getElementById("sidebar")!;
	sidebar.innerHTML = `
		<div class="sidebar-search-hint" id="sidebar-search-hint" title="全局搜索">
			<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/></svg>
			<span>搜索</span>
			<kbd id="sidebar-mod-key">Ctrl K</kbd>
		</div>
		<nav class="sidebar-nav">
			<a class="nav-item" data-view="dashboard">
				<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="1.5" y="1.5" width="5.5" height="5.5" rx="1.2"/><rect x="9" y="1.5" width="5.5" height="5.5" rx="1.2"/><rect x="1.5" y="9" width="5.5" height="5.5" rx="1.2"/><rect x="9" y="9" width="5.5" height="5.5" rx="1.2"/></svg>
				总览
			</a>
			<a class="nav-item" data-view="scenarios">
				<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4.5A1.5 1.5 0 013.5 3h2.4l1.4 1.8h5.2A1.5 1.5 0 0114 6.3v5.2a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 11.5v-7z"/></svg>
				使用场景
			</a>
			<a class="nav-item" data-view="all-prompts">
				<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 2.5h5l3 3v8a1 1 0 01-1 1h-7a1 1 0 01-1-1v-10a1 1 0 011-1z"/><path d="M9.5 2.5v3h3"/><path d="M6.5 9h4M6.5 11.5h2.5"/></svg>
				全部提示词
			</a>
			<a class="nav-item" data-view="favorites">
				<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M8 2l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.8l-3.8 2 .7-4.3-3.1-3 4.3-.6L8 2z"/></svg>
				收藏
			</a>
		</nav>
		<div class="sidebar-sep"></div>
		<nav class="sidebar-nav">
			<a class="nav-item" data-view="trash">
				<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 4.5h11M6.5 4.5V3a.8.8 0 01.8-.8h1.4a.8.8 0 01.8.8v1.5M4 4.5l.7 9a.8.8 0 00.8.7h5a.8.8 0 00.8-.7l.7-9M6.7 7.5v4M9.3 7.5v4"/></svg>
				回收站
			</a>
		</nav>
		<div class="sidebar-sep"></div>
		<nav class="sidebar-nav">
			<a class="nav-item" data-view="settings">
				<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="2.5"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4"/></svg>
				模型设置
			</a>
			<a class="nav-item" data-view="data">
				<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="8" cy="3.5" rx="5.5" ry="2"/><path d="M2.5 3.5v9c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2v-9"/><path d="M2.5 8c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2"/></svg>
				数据管理
			</a>
		</nav>
	`;
	sidebar.querySelectorAll(".nav-item").forEach((item) => {
		item.addEventListener("click", () => {
			navigate((item as HTMLElement).dataset["view"] as ViewName);
		});
	});

	// Sidebar search hint opens the command palette
	document.getElementById("sidebar-search-hint")?.addEventListener("click", () => openPalette());
	if (isMacPlatform()) {
		const kbd = document.getElementById("sidebar-mod-key");
		if (kbd) kbd.textContent = "⌘ K";
	}
}

function updateSidebarActive() {
	// prompt-detail highlights the view it was opened from
	const effective: ViewName =
		state.view === "prompt-detail" ? (state.promptOrigin as ViewName) : state.view;
	document.querySelectorAll(".nav-item").forEach((item) => {
		const view = (item as HTMLElement).dataset["view"];
		const isActive =
			view === effective ||
			(view === "scenarios" && (effective === "scenario-detail"));
		item.classList.toggle("active", isActive);
	});
}

async function render() {
	updateSidebarActive();
	try {
		switch (state.view) {
			case "dashboard":
				await renderDashboard();
				break;
			case "scenarios":
				await renderScenarios();
				break;
			case "scenario-detail":
				await renderScenarioDetail();
				break;
			case "prompt-detail":
				await renderPromptDetail();
				break;
			case "all-prompts":
				await renderAllPrompts();
				break;
			case "favorites":
				await renderFavorites();
				break;
			case "trash":
				await renderTrash();
				break;
			case "settings":
				await renderSettings();
				break;
			case "data":
				await renderDataManagement();
				break;
		}
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		setMainContent(`
			<div class="empty-state">
				加载失败: ${escapeHtml(msg)}
				<button class="btn-primary" id="err-back-btn" style="margin-top:10px">返回总览</button>
			</div>
		`);
		document.getElementById("err-back-btn")?.addEventListener("click", () => navigate("dashboard"));
	}
}

// ---- View transition ----
// Cross-fade navigation: dim the old view (~130ms), swap content, fade back in.
// A token guards against overlapping transitions when the user clicks quickly.
let transitionToken = 0;

function renderWithTransition() {
	closePalette(); // navigating away closes any open palette
	const token = ++transitionToken;
	const mc = document.getElementById("main-content")!;
	mc.classList.add("view-leaving");
	setTimeout(async () => {
		if (token !== transitionToken) return; // superseded by a newer navigation
		await render();
		if (token !== transitionToken) return;
		mc.scrollTop = 0; // new page starts at the top
		mc.classList.remove("view-leaving");
	}, 130);
}

// ---- Init ----
initWindowControls();
initThemePicker();
initSidebar();
initCommandPalette();
initTheme(); // 尽早恢复上次选择的配色（不阻塞首屏渲染）
setRenderFn(renderWithTransition);
setMainContent('<div class="empty-state">加载中...</div>');
loadAll()
	.then(() => {
		// 启动即同步一次输入区域：窗口若以上次的最大化尺寸直接创建，
		// 输入命中区域可能停留在初始配置尺寸（旧区域之外点击穿透）
		windowSyncInputRegion().catch(() => {});
		render();
	})
	.catch((err) => {
		// 启动加载失败（如数据库被占用/迁移中）：给出重试入口，而不是永远停在"加载中"
		const msg = err instanceof Error ? err.message : String(err);
		setMainContent(`
			<div class="empty-state">
				启动加载失败: ${escapeHtml(msg)}
				<button class="btn-primary" id="retry-init-btn" style="margin-top:10px">重试</button>
			</div>
		`);
		document.getElementById("retry-init-btn")?.addEventListener("click", () => location.reload());
	});
