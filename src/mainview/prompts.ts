import { state, navigate, rerender, setMainContent, escapeHtml, formatDate, showToast, rpc, loadLLMConfigs, showConfirm, copyTextToClipboard, withToast, drafts } from "./core";
import { extractVariables, fillVariables } from "../shared/types";
import { promptCardHtml, bindCopyButtons, bindFavoriteStars, ICONS } from "./components";
import type { PromptVersion, PrecheckRun, Scenario } from "../shared/types";

let currentVersions: PromptVersion[] = [];
let currentRuns: PrecheckRun[] = [];
// Variable fill state for the prompt detail page
let varValues: Record<string, string> = {};
// The active Ctrl/Cmd+S handler (module-level so re-renders replace, not stack, listeners)
let ctrlSaveHandler: ((e: KeyboardEvent) => void) | null = null;

/** Parse a comma-separated tag input into a clean string[]. */
function parseTags(input: HTMLInputElement | HTMLTextAreaElement): string[] {
	return input.value
		.split(/[,,]/)
		.map((t) => t.trim())
		.filter((t) => t);
}

// ---- Scenario Detail (prompt list) ----

export async function renderScenarioDetail() {
	if (!state.scenarioId) {
		navigate("scenarios");
		return;
	}
	await loadLLMConfigs();

	const scenario = await rpc().request.getScenario({ id: state.scenarioId });
	const prompts = await rpc().request.getPrompts({ scenario_id: state.scenarioId });
	if (state.view !== "scenario-detail") return; // user navigated away while loading

	const promptListHtml =
		prompts.length > 0
			? prompts.map(promptCardHtml).join("")
			: `<div class="empty-state"><svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h12l6 6v14a2 2 0 01-2 2H8a2 2 0 01-2-2V8a2 2 0 012-2z"/><path d="M20 6v6h6"/><path d="M11 18h10M11 22h6"/></svg>暂无提示词，点击"新建提示词"开始创建</div>`;

	setMainContent(`
		<div class="page-header">
			<div class="page-header-left">
				<button class="btn-back" id="back-btn">
					<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3L5 7l4 4"/></svg>
					返回
				</button>
				<h2>${escapeHtml(scenario.name)}</h2>
			</div>
			<div class="page-header-right">
				<button class="btn-secondary" id="edit-scenario-btn">编辑场景</button>
				<button class="btn-primary" id="new-prompt-btn">新建提示词</button>
			</div>
		</div>
		${scenario.description ? `<p class="page-desc">${escapeHtml(scenario.description)}</p>` : ""}
		${
			scenario.tags.length > 0
				? `<div class="card-tags" style="margin-bottom:16px">${scenario.tags.map((t: string) => `<span class="tag-mini">${escapeHtml(t)}</span>`).join("")}</div>`
				: ""
		}
		<div class="prompt-list">
			${promptListHtml}
		</div>
	`);

	document.getElementById("back-btn")!.addEventListener("click", () => navigate("scenarios"));
	document.getElementById("edit-scenario-btn")!.addEventListener("click", () => showEditScenarioModal(scenario));
	document.getElementById("new-prompt-btn")!.addEventListener("click", () => showPromptModal(scenario));

	bindCopyButtons(document);
	bindFavoriteStars(document, false);
	document.querySelectorAll(".prompt-card").forEach((card) => {
		card.addEventListener("click", (e) => {
			if ((e.target as HTMLElement).closest("button")) return;
			const id = parseInt((card as HTMLElement).dataset["id"]!);
			navigate("prompt-detail", state.scenarioId, id);
		});
	});
}

// ---- Prompt Detail (editor + variables + precheck + versions) ----

export async function renderPromptDetail() {
	if (!state.promptId) {
		navigate("scenarios");
		return;
	}
	await loadLLMConfigs();

	const p = await rpc().request.getPrompt({ id: state.promptId });
	currentVersions = await rpc().request.getPromptVersions({ prompt_id: state.promptId });
	currentRuns = await rpc().request.getPrecheckRuns({ prompt_id: state.promptId });
	if (state.view !== "prompt-detail") return; // user navigated away while loading
	varValues = {};
	const llmOptions = state.llmConfigs
		.map((c) => `<option value="${c.id}"${c.is_active ? " selected" : ""}>${escapeHtml(c.name)} (${escapeHtml(c.model)})</option>`)
		.join("");
	const llmSelectHtml = state.llmConfigs.length > 0 ? `<select id="precheck-llm">${llmOptions}</select>` : `<p class="empty-state-small">请先在模型设置中配置大模型</p>`;

	setMainContent(`
		<div class="page-header">
			<div class="page-header-left">
				<button class="btn-back" id="back-btn">
					<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3L5 7l4 4"/></svg>
					返回
				</button>
				<h2>提示词编辑</h2>
			</div>
			<div class="page-header-right">
				<button class="btn-primary" id="save-prompt-btn">保存</button>
				<button class="btn-secondary danger" id="delete-prompt-btn">删除</button>
			</div>
		</div>

		<div class="prompt-detail-layout">
			<div class="prompt-editor">
				<div class="form-group">
					<label>标题</label>
					<input type="text" id="prompt-title" value="${escapeHtml(p.title)}" />
				</div>
				<div class="form-group">
					<label>标签（逗号分隔，用于区分同场景下不同方向）</label>
					<input type="text" id="prompt-tags" value="${escapeHtml((p.tags ?? []).join(", "))}" placeholder="例如：正式, 口语化, 小红书" />
				</div>
				<div class="form-group">
					<label>提示词内容</label>
					<textarea id="prompt-content" rows="16" placeholder="输入或编辑提示词内容，支持 {{变量名}} 占位符...">${escapeHtml(p.content)}</textarea>
				</div>
				<div class="prompt-meta">
					<button class="fav-star${p.is_favorite ? " active" : ""}" data-fav-prompt="${p.id}" title="${p.is_favorite ? "取消收藏" : "收藏"}">${ICONS.star(!!p.is_favorite)}</button>
					${p.source === "ai" ? '<span class="source-badge source-ai">AI 生成</span>' : '<span class="source-badge source-manual">手动编写</span>'}
					${p.model_name ? `<span class="card-meta">模型: ${escapeHtml(p.model_name)}</span>` : ""}
					<span class="card-meta">创建于 ${formatDate(p.created_at)}</span>
					${p.use_count > 0 ? `<span class="card-meta">已使用 ${p.use_count} 次</span>` : ""}
				</div>
			</div>

			<div class="prompt-sidebar">
				<div class="sidebar-section" id="variables-section">
					<div class="section-title-row">
						<h3 class="section-title">变量填充</h3>
						<span class="var-count-badge" id="var-count-badge"></span>
					</div>
					<div id="variables-body"></div>
				</div>

				<div class="sidebar-section">
					<h3 class="section-title">预检</h3>
					<div class="form-row">
						<div class="form-group form-group-inline">
							<label>类型</label>
							<select id="precheck-type">
								<option value="text">生成文本</option>
								<option value="image">生成图片</option>
								<option value="optimize">优化文本</option>
							</select>
						</div>
						<div class="form-group form-group-inline">
							<label>模型</label>
							${llmSelectHtml}
						</div>
					</div>
					<div class="form-group" id="optimize-input-group" style="display:none">
						<label>待优化文本</label>
						<textarea id="precheck-input" rows="4" placeholder="粘贴需要优化的文本..."></textarea>
					</div>
					<button class="btn-primary btn-block" id="run-precheck-btn">运行预检</button>
					<div id="precheck-results" class="precheck-results">
						${renderRunsHtml()}
					</div>
				</div>

				<div class="sidebar-section">
					<h3 class="section-title">版本历史</h3>
					<div id="version-list" class="version-list">
						${renderVersionsHtml()}
					</div>
				</div>
			</div>
		</div>
	`);

	attachPromptDetailListeners();
}

// ---- Variable fill panel ----

/** Rebuild the variable fill panel from the editor's current content, keeping typed values. */
function refreshVariablePanel() {
	const body = document.getElementById("variables-body");
	const badge = document.getElementById("var-count-badge");
	if (!body || !badge) return;

	const content = (document.getElementById("prompt-content") as HTMLTextAreaElement | null)?.value ?? "";
	const names = extractVariables(content);

	// Drop values for variables that no longer exist
	for (const key of Object.keys(varValues)) {
		if (!names.includes(key)) delete varValues[key];
	}

	if (names.length === 0) {
		badge.textContent = "";
		body.innerHTML = '<p class="empty-state-small">此提示词未包含变量。在内容中使用 {{变量名}} 即可自动识别。</p>';
		return;
	}

	badge.textContent = `${names.length} 个变量`;
	body.innerHTML = `
		${names
			.map(
				(n) => `
			<div class="var-field">
				<label>${escapeHtml(n)}</label>
				<input type="text" class="var-input" data-var="${escapeHtml(n)}" value="${escapeHtml(varValues[n] ?? "")}" placeholder="输入 ${escapeHtml(n)} 的值…" />
			</div>
		`,
			)
			.join("")}
		<div class="var-preview-wrap">
			<label>填充预览</label>
			<pre class="var-preview" id="var-preview"></pre>
		</div>
		<button class="btn-primary btn-block" id="copy-filled-btn">
			<span class="copy-icon">${ICONS.copy}</span>
			<span class="copy-label">复制填充结果</span>
		</button>
	`;

	body.querySelectorAll<HTMLInputElement>(".var-input").forEach((input) => {
		input.addEventListener("input", () => {
			varValues[input.dataset["var"]!] = input.value;
			updateVariablePreview();
		});
	});

	const copyBtn = body.querySelector("#copy-filled-btn") as HTMLButtonElement;
	copyBtn.addEventListener("click", async () => {
		const content2 = (document.getElementById("prompt-content") as HTMLTextAreaElement).value;
		const filled = fillVariables(content2, varValues);
		const ok = await copyTextToClipboard(filled);
		if (!ok) {
			showToast("复制失败，请重试", "error");
			return;
		}
		rpc()
			.request.recordPromptUse({ id: state.promptId! })
			.catch(() => {});
		showToast("已复制填充结果", "success");
		const label = copyBtn.querySelector(".copy-label")!;
		copyBtn.classList.add("copied");
		label.textContent = "已复制";
		setTimeout(() => {
			copyBtn.classList.remove("copied");
			label.textContent = "复制填充结果";
		}, 1500);
	});

	updateVariablePreview();
}

function updateVariablePreview() {
	const pre = document.getElementById("var-preview");
	if (!pre) return;
	const content = (document.getElementById("prompt-content") as HTMLTextAreaElement | null)?.value ?? "";
	pre.textContent = fillVariables(content, varValues);
}

function renderRunsHtml(): string {
	if (currentRuns.length === 0) {
		return '<div class="empty-state-small">暂无预检记录</div>';
	}
	return currentRuns.map(renderRun).join("");
}

function renderRun(run: PrecheckRun): string {
	const typeLabels: Record<string, string> = { text: "文本", image: "图片", optimize: "优化" };
	const typeLabel = typeLabels[run.type] || run.type;
	const isError = run.output_text.startsWith("[Error]");

	// 超长输出截断展示（data: 图片走 <img> 不受影响）
	const MAX_OUTPUT_CHARS = 50_000;
	let outputText = run.output_text;
	if (!isError && outputText.length > MAX_OUTPUT_CHARS) {
		outputText = outputText.slice(0, MAX_OUTPUT_CHARS) + "\n…（输出过长，已截断展示）";
	}

	let outputHtml: string;
	// 只有 data: URL 能在应用内直接渲染；http 外链会被混合内容策略拦截，展示为可复制的文本
	if (run.type === "image" && !isError && run.output_text.startsWith("data:image")) {
		outputHtml = `<img class="run-image" src="${escapeHtml(run.output_text)}" alt="生成图片" />`;
	} else {
		outputHtml = `<pre class="run-text${isError ? " error-text" : ""}">${escapeHtml(outputText)}</pre>`;
	}

	const inputHtml =
		run.type === "optimize" && run.input_text
			? `<details class="run-input"><summary>输入文本</summary><pre>${escapeHtml(run.input_text)}</pre></details>`
			: "";

	return `
		<div class="precheck-run">
			<div class="run-header">
				<span class="run-type-badge run-type-${run.type}">${typeLabel}</span>
				<span class="run-model">${escapeHtml(run.model_name)}</span>
				<span class="run-date">${formatDate(run.created_at)}</span>
			</div>
			<div class="run-output">${outputHtml}</div>
			${inputHtml}
		</div>
	`;
}

function renderVersionsHtml(): string {
	if (currentVersions.length === 0) {
		return '<div class="empty-state-small">暂无历史版本</div>';
	}
	return currentVersions
		.map(
			(v) => `
			<div class="version-item" data-version-id="${v.id}">
				<div class="version-row">
					<span class="version-number">v${v.version_number}</span>
					<span class="version-date">${formatDate(v.created_at)}</span>
					<button class="btn-small" data-action="view">查看</button>
					<button class="btn-small" data-action="restore">恢复</button>
				</div>
				<div class="version-content" style="display:none">
					<pre>${escapeHtml(v.content)}</pre>
				</div>
			</div>
		`,
		)
		.join("");
}

function attachPromptDetailListeners() {
	// Back — return to the view the prompt was opened from
	document.getElementById("back-btn")!.addEventListener("click", () => {
		const origin = state.promptOrigin;
		if (origin === "all-prompts" || origin === "favorites" || origin === "dashboard") {
			navigate(origin);
		} else {
			navigate("scenario-detail", state.scenarioId);
		}
	});

	const savePrompt = async () => {
		const title = (document.getElementById("prompt-title") as HTMLInputElement).value.trim();
		const content = (document.getElementById("prompt-content") as HTMLTextAreaElement).value;
		if (!title) {
			showToast("请输入标题", "error");
			return;
		}
		const tags = parseTags(document.getElementById("prompt-tags") as HTMLInputElement);
		const ok = await withToast(() => rpc().request.updatePrompt({ id: state.promptId!, title, content, tags }), "保存失败");
		if (!ok) return;
		// Reload versions
		currentVersions = await rpc().request.getPromptVersions({ prompt_id: state.promptId! });
		document.getElementById("version-list")!.innerHTML = renderVersionsHtml();
		attachVersionListeners();
		showToast("提示词已保存", "success");
	};

	// Save button + Ctrl/Cmd+S (guarded: only acts while the save button exists)
	document.getElementById("save-prompt-btn")!.addEventListener("click", savePrompt);
	if (ctrlSaveHandler) document.removeEventListener("keydown", ctrlSaveHandler, true);
	ctrlSaveHandler = (e: KeyboardEvent) => {
		if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
			if (!document.getElementById("save-prompt-btn")) return; // not on this page anymore
			e.preventDefault();
			savePrompt();
		}
	};
	document.addEventListener("keydown", ctrlSaveHandler, true);

	// Delete (soft-delete to trash)
	document.getElementById("delete-prompt-btn")!.addEventListener("click", async () => {
		const ok = await showConfirm({
			title: "删除此提示词？",
			message: "提示词将移入回收站，可随时恢复。其版本历史与预检记录会一并保留。",
			confirmText: "移入回收站",
			danger: true,
		});
		if (!ok) return;
		await rpc().request.trashPrompt({ id: state.promptId! });
		showToast("已移入回收站", "success");
		const origin = state.promptOrigin;
		if (origin === "all-prompts" || origin === "favorites" || origin === "dashboard") {
			navigate(origin);
		} else {
			navigate("scenario-detail", state.scenarioId);
		}
	});

	// Variable panel reacts to editor changes
	const contentTextarea = document.getElementById("prompt-content") as HTMLTextAreaElement;
	contentTextarea.addEventListener("input", refreshVariablePanel);
	refreshVariablePanel();

	// Favorite star in the meta row
	bindFavoriteStars(document, false);

	// Precheck type change
	const typeSelect = document.getElementById("precheck-type") as HTMLSelectElement;
	typeSelect.addEventListener("change", () => {
		const inputGroup = document.getElementById("optimize-input-group")!;
		inputGroup.style.display = typeSelect.value === "optimize" ? "block" : "none";
	});

	// Run precheck
	const runBtn = document.getElementById("run-precheck-btn") as HTMLButtonElement;
	runBtn.addEventListener("click", async () => {
		const type = typeSelect.value;
		const llmSelect = document.getElementById("precheck-llm") as HTMLSelectElement | null;
		if (!llmSelect || !llmSelect.value) {
			showToast("请先配置并选择大模型", "error");
			return;
		}
		const llmId = parseInt(llmSelect.value);
		const inputText = type === "optimize" ? (document.getElementById("precheck-input") as HTMLTextAreaElement).value : "";

		runBtn.textContent = "生成中...";
		runBtn.disabled = true;

		try {
			const run = await rpc().request.runPrecheck({
				prompt_id: state.promptId!,
				type,
				input_text: inputText,
				llm_config_id: llmId,
			});
			currentRuns.unshift(run);
			document.getElementById("precheck-results")!.innerHTML = renderRunsHtml();
			if (run.output_text.startsWith("[Error]")) {
				showToast("预检失败: " + run.output_text.substring(8), "error");
			} else {
				showToast("预检完成", "success");
			}
		} catch (err) {
			showToast("预检请求失败: " + (err instanceof Error ? err.message : String(err)), "error");
		}

		runBtn.textContent = "运行预检";
		runBtn.disabled = false;
	});

	attachVersionListeners();
}

function attachVersionListeners() {
	document.querySelectorAll(".version-item").forEach((item) => {
		const el = item as HTMLElement;
		const versionId = parseInt(el.dataset["versionId"]!);
		const contentEl = el.querySelector(".version-content") as HTMLElement;

		el.querySelector('[data-action="view"]')!.addEventListener("click", () => {
			contentEl.style.display = contentEl.style.display === "none" ? "block" : "none";
		});

		el.querySelector('[data-action="restore"]')!.addEventListener("click", () => {
			const version = currentVersions.find((v) => v.id === versionId);
			if (!version) return;
			(document.getElementById("prompt-content") as HTMLTextAreaElement).value = version.content;
			refreshVariablePanel();
			showToast(`已恢复到 v${version.version_number}，请点击保存以确认`, "info");
		});
	});
}

// ---- New Prompt Modal (manual + AI generation) ----

/** 业务弹窗通用装配：不响应遮罩点击关闭（防误触丢内容），Esc = 取消。返回 close。 */
function setupModal(close: () => void): () => void {
	const esc = (e: KeyboardEvent) => {
		if (e.key === "Escape") {
			e.stopPropagation();
			e.preventDefault();
			close();
		}
	};
	document.addEventListener("keydown", esc, true);
	return () => document.removeEventListener("keydown", esc, true);
}

function showPromptModal(scenario: Scenario) {
	const draft = drafts.prompt;
	const overlay = document.createElement("div");
	overlay.className = "modal-overlay";
	overlay.innerHTML = `
		<div class="modal modal-wide">
			<h3>新建提示词</h3>
			<div class="form-group">
				<label>标题</label>
				<input type="text" id="pm-title" value="${escapeHtml(draft?.title ?? "")}" placeholder="提示词标题" />
			</div>
			<div class="form-group">
				<label>标签（逗号分隔，可选）</label>
				<input type="text" id="pm-tags" value="${escapeHtml(draft?.tags ?? "")}" placeholder="例如：正式, 口语化, 小红书" />
			</div>
			<div class="form-group">
				<label>提示词内容</label>
				<textarea id="pm-content" rows="10" placeholder="输入提示词内容，或使用下方 AI 生成。支持 {{变量名}} 占位符。">${escapeHtml(draft?.content ?? "")}</textarea>
			</div>
			<div class="ai-section">
				<div class="ai-section-title">AI 生成（可选）</div>
				<div class="form-row">
					<div class="form-group form-group-inline" style="flex:1">
						<label>生成说明</label>
						<input type="text" id="pm-desc" value="${escapeHtml(draft?.aiDesc ?? "")}" placeholder="描述你想要的提示词，例如：写一个产品文案的提示词" />
					</div>
					<div class="form-group form-group-inline">
						<label>模型</label>
						<select id="pm-llm">
							${state.llmConfigs.map((c) => `<option value="${c.id}"${c.is_active ? " selected" : ""}>${escapeHtml(c.name)}</option>`).join("")}
						</select>
					</div>
					<button class="btn-secondary" id="pm-generate" ${state.llmConfigs.length === 0 ? "disabled" : ""}>AI生成</button>
				</div>
				${state.llmConfigs.length === 0 ? '<p class="empty-state-small">请先在模型设置中配置大模型</p>' : ""}
			</div>
			<p class="form-hint">误触关闭不会丢失已填内容，重新打开即可继续；切换页面才会清空草稿。</p>
			<div class="modal-actions">
				<button class="btn-secondary" id="pm-cancel">取消</button>
				<button class="btn-primary" id="pm-save">创建</button>
			</div>
		</div>
	`;
	document.body.appendChild(overlay);

	let usedAI = false;
	let aiModelName = "";

	// 草稿实时捕获
	const captureDraft = () => {
		drafts.prompt = {
			title: (overlay.querySelector("#pm-title") as HTMLInputElement).value,
			tags: (overlay.querySelector("#pm-tags") as HTMLInputElement).value,
			content: (overlay.querySelector("#pm-content") as HTMLTextAreaElement).value,
			aiDesc: (overlay.querySelector("#pm-desc") as HTMLInputElement).value,
		};
	};
	overlay.addEventListener("input", captureDraft);

	const close = () => {
		detachEsc();
		overlay.remove();
	};
	const detachEsc = setupModal(close);

	// AI generate
	const genBtn = overlay.querySelector("#pm-generate") as HTMLButtonElement;
	genBtn.addEventListener("click", async () => {
		const desc = (overlay.querySelector("#pm-desc") as HTMLInputElement).value.trim();
		const llmId = parseInt((overlay.querySelector("#pm-llm") as HTMLSelectElement).value);
		const config = state.llmConfigs.find((c) => c.id === llmId);
		if (!config) return;

		genBtn.textContent = "生成中...";
		genBtn.disabled = true;

		try {
			const result = await rpc().request.generatePromptAI({
				scenario_name: scenario.name,
				description: desc || scenario.description,
				llm_config_id: llmId,
			});
			(overlay.querySelector("#pm-content") as HTMLTextAreaElement).value = result.content;
			captureDraft();
			usedAI = true;
			aiModelName = config.name;
			showToast("AI 生成完成", "success");
		} catch (err) {
			showToast("生成失败: " + (err instanceof Error ? err.message : String(err)), "error");
		}

		genBtn.textContent = "AI生成";
		genBtn.disabled = false;
	});

	// Save
	const save = async () => {
		const title = (overlay.querySelector("#pm-title") as HTMLInputElement).value.trim();
		const content = (overlay.querySelector("#pm-content") as HTMLTextAreaElement).value;
		if (!title) {
			showToast("请输入标题", "error");
			return;
		}
		if (!content.trim()) {
			showToast("请输入提示词内容", "error");
			return;
		}
		const tags = parseTags(overlay.querySelector("#pm-tags") as HTMLInputElement);
		const ok = await withToast(
			() =>
				rpc().request.createPrompt({
					scenario_id: state.scenarioId!,
					title,
					content,
					source: usedAI ? "ai" : "manual",
					model_name: usedAI ? aiModelName : undefined,
					tags,
				}),
			"创建失败",
		);
		if (!ok) return;
		drafts.prompt = null; // 保存成功才清草稿
		close();
		showToast("提示词已创建", "success");
		rerender();
	};

	overlay.querySelector("#pm-cancel")!.addEventListener("click", close);
	overlay.querySelector("#pm-save")!.addEventListener("click", save);
}

// ---- Edit Scenario Modal ----

function showEditScenarioModal(scenario: Scenario) {
	const overlay = document.createElement("div");
	overlay.className = "modal-overlay";
	overlay.innerHTML = `
		<div class="modal">
			<h3>编辑场景</h3>
			<div class="form-group">
				<label>场景名称</label>
				<input type="text" id="es-name" value="${escapeHtml(scenario.name)}" />
			</div>
			<div class="form-group">
				<label>场景描述</label>
				<textarea id="es-desc" rows="3">${escapeHtml(scenario.description)}</textarea>
			</div>
			<div class="form-group">
				<label>标签（逗号分隔）</label>
				<input type="text" id="es-tags" value="${escapeHtml(scenario.tags.join(", "))}" />
			</div>
			<div class="modal-actions">
				<button class="btn-secondary" id="es-cancel">取消</button>
				<button class="btn-primary" id="es-save">保存</button>
			</div>
		</div>
	`;
	document.body.appendChild(overlay);

	const close = () => {
		detachEsc();
		overlay.remove();
	};
	const detachEsc = setupModal(close);

	overlay.querySelector("#es-cancel")!.addEventListener("click", close);

	overlay.querySelector("#es-save")!.addEventListener("click", async () => {
		const name = (overlay.querySelector("#es-name") as HTMLInputElement).value.trim();
		if (!name) {
			showToast("请输入场景名称", "error");
			return;
		}
		const desc = (overlay.querySelector("#es-desc") as HTMLTextAreaElement).value.trim();
		const tags = (overlay.querySelector("#es-tags") as HTMLInputElement)
			.value.split(/[,,]/)
			.map((t) => t.trim())
			.filter((t) => t);

		const ok = await withToast(() => rpc().request.updateScenario({ id: scenario.id, name, description: desc, tags }), "保存失败");
		if (!ok) return;
		close();
		showToast("场景已更新", "success");
		rerender();
	});
}
