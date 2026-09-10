import { state, loadLLMConfigs, rerender, setMainContent, escapeHtml, showToast, rpc, PROVIDER_DEFAULTS, showConfirm, withToast } from "./core";
import type { LLMConfig } from "../shared/types";

export async function renderSettings() {
	await loadLLMConfigs();
	if (state.view !== "settings") return; // user navigated away while loading

	const configsHtml =
		state.llmConfigs.length > 0
			? state.llmConfigs.map(configRow).join("")
			: `<div class="empty-state"><svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="16" cy="16" r="5"/><path d="M16 4v4M16 24v4M4 16h4M24 16h4M7.5 7.5l2.8 2.8M21.7 21.7l2.8 2.8M7.5 24.5l2.8-2.8M21.7 10.3l2.8-2.8"/></svg>暂未配置大模型，点击下方"添加模型"开始</div>`;

	setMainContent(`
		<div class="page-header">
			<h2>模型设置</h2>
			<button class="btn-primary" id="add-llm-btn">添加模型</button>
		</div>
		<p class="page-desc">配置大语言模型连接。支持 DeepSeek、MiMo、Ollama 及任何 OpenAI 兼容接口。</p>
		<div class="config-list" id="config-list">
			${configsHtml}
		</div>
	`);
	attachListeners();
}

function configRow(c: LLMConfig): string {
	const providerLabels: Record<string, string> = {
		deepseek: "DeepSeek",
		mimo: "MiMo",
		ollama: "Ollama",
		custom: "自定义",
	};
	return `
		<div class="card config-row${c.is_active ? " active" : ""}" data-id="${c.id}">
			<div class="config-info">
				<div class="config-name">
					${escapeHtml(c.name)}
					${c.is_active ? '<span class="badge-active">使用中</span>' : ""}
				</div>
				<div class="config-meta">
					<span>${providerLabels[c.provider] || c.provider}</span>
					<span class="dot-sep">·</span>
					<span>${escapeHtml(c.model)}</span>
					<span class="dot-sep">·</span>
					<span class="config-url">${escapeHtml(c.base_url)}</span>
				</div>
			</div>
			<div class="config-actions">
				<button class="btn-small" data-action="test" data-id="${c.id}">测试</button>
				<button class="btn-small" data-action="edit" data-id="${c.id}">编辑</button>
				${c.is_active ? "" : `<button class="btn-small btn-primary" data-action="activate" data-id="${c.id}">设为默认</button>`}
				<button class="btn-small danger" data-action="delete" data-id="${c.id}">删除</button>
			</div>
		</div>
	`;
}

function attachListeners() {
	document.getElementById("add-llm-btn")!.addEventListener("click", () => showLLMModal());

	document.querySelectorAll(".config-row [data-action]").forEach((btn) => {
		btn.addEventListener("click", async () => {
			const el = btn as HTMLElement;
			const action = el.dataset["action"]!;
			const id = parseInt(el.dataset["id"]!);

			if (action === "test") {
				el.textContent = "测试中...";
				(el as HTMLButtonElement).disabled = true;
				const result = await rpc().request.testLLMConfig({ id });
				el.textContent = "测试";
				(el as HTMLButtonElement).disabled = false;
				showToast(result.message, result.success ? "success" : "error");
			} else if (action === "edit") {
				const config = state.llmConfigs.find((c) => c.id === id);
				if (config) showLLMModal(config);
			} else if (action === "activate") {
				const ok = await withToast(() => rpc().request.setActiveLLMConfig({ id }), "设置默认失败");
				if (!ok) return;
				await loadLLMConfigs();
				rerender();
				showToast("已设为默认模型", "success");
			} else if (action === "delete") {
				const ok = await showConfirm({
					title: "删除此模型配置？",
					message: "仅删除连接配置，不影响已生成的提示词与预检记录。",
					confirmText: "删除",
					danger: true,
				});
				if (!ok) return;
				await rpc().request.deleteLLMConfig({ id });
				await loadLLMConfigs();
				rerender();
				showToast("配置已删除", "success");
			}
		});
	});
}

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

function showLLMModal(config?: LLMConfig) {
	const overlay = document.createElement("div");
	overlay.className = "modal-overlay";
	overlay.innerHTML = `
		<div class="modal">
			<h3>${config ? "编辑模型配置" : "添加模型配置"}</h3>
			<div class="form-group">
				<label>名称</label>
				<input type="text" id="llm-name" value="${config ? escapeHtml(config.name) : ""}" placeholder="例如：我的 DeepSeek" />
			</div>
			<div class="form-group">
				<label>提供商</label>
				<select id="llm-provider">
					<option value="deepseek" ${config?.provider === "deepseek" ? "selected" : ""}>DeepSeek</option>
					<option value="mimo" ${config?.provider === "mimo" ? "selected" : ""}>MiMo (小米)</option>
					<option value="ollama" ${config?.provider === "ollama" ? "selected" : ""}>Ollama (本地)</option>
					<option value="custom" ${config?.provider === "custom" ? "selected" : ""}>自定义</option>
				</select>
			</div>
			<div class="form-group">
				<label>API Base URL</label>
				<input type="text" id="llm-url" value="${config ? escapeHtml(config.base_url) : ""}" placeholder="https://api.deepseek.com/v1" />
			</div>
			<div class="form-group">
				<label>API Key${config?.provider === "ollama" ? " (Ollama 通常不需要)" : ""}</label>
				<input type="password" id="llm-key" value="${config ? escapeHtml(config.api_key) : ""}" placeholder="sk-..." />
			</div>
			<div class="form-group">
				<label>模型名称</label>
				<input type="text" id="llm-model" value="${config ? escapeHtml(config.model) : ""}" placeholder="deepseek-chat" />
			</div>
			<div class="modal-actions">
				<button class="btn-secondary" id="modal-cancel">取消</button>
				<button class="btn-primary" id="modal-save">${config ? "保存" : "添加"}</button>
			</div>
		</div>
	`;
	document.body.appendChild(overlay);

	const providerSelect = overlay.querySelector("#llm-provider") as HTMLSelectElement;
	const urlInput = overlay.querySelector("#llm-url") as HTMLInputElement;
	const modelInput = overlay.querySelector("#llm-model") as HTMLInputElement;

	// Auto-fill defaults when provider changes (only for new configs)
	if (!config) {
		providerSelect.addEventListener("change", () => {
			const defaults = PROVIDER_DEFAULTS[providerSelect.value];
			if (defaults) {
				urlInput.value = defaults.base_url;
				modelInput.value = defaults.model;
			}
		});
	}

	const close = () => {
		detachEsc();
		overlay.remove();
	};
	const detachEsc = setupModal(close);
	overlay.querySelector("#modal-cancel")!.addEventListener("click", close);

	const save = async () => {
		const name = (overlay.querySelector("#llm-name") as HTMLInputElement).value.trim();
		const provider = providerSelect.value;
		const baseUrl = urlInput.value.trim();
		const apiKey = (overlay.querySelector("#llm-key") as HTMLInputElement).value.trim();
		const model = modelInput.value.trim();

		if (!name || !baseUrl || !model) {
			showToast("请填写名称、URL 和模型名称", "error");
			return;
		}

		const ok = await withToast(async () => {
			if (config) {
				await rpc().request.updateLLMConfig({ id: config.id, name, provider, api_key: apiKey, base_url: baseUrl, model });
			} else {
				await rpc().request.createLLMConfig({ name, provider, api_key: apiKey, base_url: baseUrl, model });
			}
		}, "保存失败");
		if (!ok) return;
		showToast(config ? "配置已更新" : "配置已添加", "success");
		close();
		await loadLLMConfigs();
		rerender();
	};

	overlay.querySelector("#modal-save")!.addEventListener("click", save);
}

// ---- Data Management ----

export async function renderDataManagement() {
		// 获取当前存储路径
		let pathInfo: { current: string; default: string; custom: string | null; dbPath: string; configSource: string; portableConfigPath: string };
		try {
			pathInfo = await rpc().request.getDataPath({});
		} catch {
			pathInfo = { current: "", default: "", custom: null, dbPath: "", configSource: "appdata", portableConfigPath: "" };
		}
		if (state.view !== "data") return; // user navigated away while loading

		const configHint =
			pathInfo.configSource === "portable"
				? `配置来源：便携版 config.json（${pathInfo.portableConfigPath}）。升级替换程序时"覆盖解压"或保留此文件，数据目录选择永不丢失。`
				: "配置来源：应用数据目录 config.json（位于系统用户目录，升级替换程序时自动保留）。也可以在程序 bin 目录创建 config.json 指定数据目录。";
	if (state.view !== "data") return; // user navigated away while loading

	setMainContent(`
		<div class="page-header">
			<h2>数据管理</h2>
		</div>
		<p class="page-desc">管理数据存储位置，导出备份或从备份文件导入数据。</p>

		<!-- 存储位置 -->
		<div class="card panel-card" style="margin-bottom: 24px;">
			<div class="card-header">
				<div class="card-title">数据存储位置</div>
			</div>
			<p class="card-desc" style="margin-bottom: 12px;">修改数据存储路径后，现有数据会自动迁移到新位置，应用将重启以加载新数据。</p>
			<div class="form-group-inline">
				<label>当前路径</label>
				<div style="display: flex; gap: 8px; align-items: center;">
					<input type="text" id="data-path-input" value="${escapeHtml(pathInfo.current)}" placeholder="选择或输入新路径" style="flex: 1; min-width: 0; font-family: var(--font-mono); font-size: 12px;" />
					<button class="btn-small" id="browse-path-btn" title="打开系统文件夹选择器" style="flex-shrink: 0; display: inline-flex; align-items: center;">
						<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px;"><path d="M1.5 3.5a1 1 0 011-1h3l1.5 1.5h5a1 1 0 011 1v6a1 1 0 01-1 1h-9.5a1 1 0 01-1-1v-8.5z"/></svg>
						浏览...
					</button>
				</div>
			</div>
			<div style="display: flex; gap: 8px; margin-top: 8px; flex-wrap: wrap;">
				<button class="btn-small btn-primary" id="migrate-btn">
					<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px; vertical-align: middle;"><path d="M7 2v8M7 2L4 5M7 2l3 3M2 10v1a1 1 0 001 1h8a1 1 0 001 1h8a1 1 0 001-1v-1"/></svg>
					迁移到新位置
				</button>
				<button class="btn-small" id="check-path-btn">检查路径</button>
				<span id="path-check-status" style="font-size: 12px; line-height: 26px;"></span>
				${pathInfo.custom ? '<button class="btn-small" id="reset-path-btn">恢复默认位置</button>' : ""}
			</div>
			<div style="margin-top: 8px; font-size: 11.5px; color: var(--text-tertiary); line-height: 1.6;">
				默认位置：${escapeHtml(pathInfo.default)}<br/>
				${escapeHtml(configHint)}
			</div>
		</div>

		<!-- 导入导出 -->
		<div class="data-section">
			<div class="data-card">
				<div class="data-card-icon">
					<svg width="28" height="28" viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4v14M14 4l-5 5M14 4l5 5M5 20v2a2 2 0 002 2h14a2 2 0 002-2v-2"/></svg>
				</div>
				<h3>导出数据</h3>
				<p>将所有使用场景、提示词、预检记录和模型配置导出为 JSON 文件。</p>
				<button class="btn-primary" id="export-btn">导出为 JSON</button>
			</div>

			<div class="data-card">
				<div class="data-card-icon">
					<svg width="28" height="28" viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 18V4M14 4l-5 5M14 4l5 5M5 20v2a2 2 0 002 2h14a2 2 0 002-2v-2"/></svg>
				</div>
				<h3>导入数据</h3>
				<p>从 JSON 备份文件导入数据。注意：导入会覆盖当前所有数据。</p>
				<input type="file" id="import-file" accept=".json" style="display:none" />
				<button class="btn-secondary" id="import-btn">选择文件导入</button>
			</div>
		</div>
	`);

	document.getElementById("export-btn")!.addEventListener("click", async () => {
		const result = await rpc().request.exportData({});
		const fileName = `PromptHub-export-${new Date().toISOString().slice(0, 10)}.json`;

		// 优先使用系统文件夹选择器（WebView2 File System Access API），
		// 让用户明确选择导出位置；不支持时回退为浏览器下载
		type DirHandle = { name: string; getFileHandle: (n: string, o: { create: boolean }) => Promise<{ createWritable: () => Promise<{ write: (d: Blob) => Promise<void>; close: () => Promise<void> }> }> };
		const picker = (window as unknown as { showDirectoryPicker?: (o?: { mode: string }) => Promise<DirHandle> }).showDirectoryPicker;
		if (picker) {
			try {
				const dir = await picker({ mode: "readwrite" });
				const file = await dir.getFileHandle(fileName, { create: true });
				const w = await file.createWritable();
				await w.write(new Blob([result.data]));
				await w.close();
				showToast(`已导出到「${dir.name}」文件夹：${fileName}`, "success");
				return;
			} catch (err) {
				if ((err as DOMException)?.name === "AbortError") return; // 用户取消了选择
				// 其他错误走下方回退
			}
		}
		const blob = new Blob([result.data], { type: "application/json" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = fileName;
		a.click();
		URL.revokeObjectURL(url);
		showToast("已开始下载，请查看系统「下载」文件夹（默认 Downloads）", "info");
	});

	const fileInput = document.getElementById("import-file") as HTMLInputElement;
	document.getElementById("import-btn")!.addEventListener("click", () => fileInput.click());

	fileInput.addEventListener("change", async () => {
		const file = fileInput.files?.[0];
		if (!file) return;
		const ok = await showConfirm({
			title: "导入并覆盖当前数据？",
			message: "导入将永久覆盖当前所有场景、提示词与配置，建议先导出备份。",
			confirmText: "覆盖导入",
			danger: true,
		});
		if (!ok) {
			fileInput.value = "";
			return;
		}
		const text = await file.text();
		const result = await rpc().request.importData({ data: text });
		showToast(result.message, result.success ? "success" : "error");
		fileInput.value = "";
		if (result.success) {
			await loadLLMConfigs();
			rerender();
		}
	});

	// 浏览：弹出原生文件夹选择对话框，选中后回填输入框
	const browseBtn = document.getElementById("browse-path-btn") as HTMLButtonElement;
	browseBtn.addEventListener("click", async () => {
		const input = document.getElementById("data-path-input") as HTMLInputElement;
		browseBtn.disabled = true;
		try {
			const result = await rpc().request.selectFolder({ startPath: input.value });
			if (result.path) {
				input.value = result.path;
			} else if (result.message) {
				showToast(result.message, "error");
			}
		} finally {
			browseBtn.disabled = false;
		}
	});

	// 检查路径（不迁移，仅校验存在/可写）
	document.getElementById("check-path-btn")?.addEventListener("click", async () => {
		const input = document.getElementById("data-path-input") as HTMLInputElement;
		const status = document.getElementById("path-check-status")!;
		status.textContent = "检查中…";
		status.style.color = "var(--text-secondary)";
		const result = await rpc().request.validateDataDir({ path: input.value });
		status.textContent = result.message;
		status.style.color = result.ok ? "var(--success)" : "var(--danger)";
	});

	// 迁移数据
	const migrateBtn = document.getElementById("migrate-btn") as HTMLButtonElement;
	migrateBtn.addEventListener("click", async () => {
		const newPath = (document.getElementById("data-path-input") as HTMLInputElement).value.trim();
		if (!newPath) {
			showToast("请输入新的存储路径", "error");
			return;
		}
		const ok = await showConfirm({
			title: "迁移数据存储位置？",
			message: `数据将迁移到：${newPath}。迁移后应用会自动关闭，请重新打开。`,
			confirmText: "开始迁移",
		});
		if (!ok) return;

		migrateBtn.textContent = "迁移中...";
		migrateBtn.disabled = true;
		const result = await rpc().request.migrateData({ newPath });
		if (result.success) {
			showToast(result.message, "success");
			// 延迟关闭，让 toast 显示
			setTimeout(() => {
				rpc().request.windowClose({});
			}, 2000);
		} else {
			showToast(result.message, "error");
			migrateBtn.textContent = "迁移到新位置";
			migrateBtn.disabled = false;
		}
	});

	// 恢复默认位置
	const resetBtn = document.getElementById("reset-path-btn");
	if (resetBtn) {
		resetBtn.addEventListener("click", async () => {
			const ok = await showConfirm({
				title: "恢复到默认存储位置？",
				message: "现有数据会迁移回默认位置，迁移后应用会自动关闭。",
				confirmText: "恢复默认",
			});
			if (!ok) return;
			(resetBtn as HTMLButtonElement).textContent = "迁移中...";
			(resetBtn as HTMLButtonElement).disabled = true;
			const result = await rpc().request.migrateData({ newPath: pathInfo.default });
			if (result.success) {
				showToast(result.message, "success");
				setTimeout(() => rpc().request.windowClose({}), 2000);
			} else {
				showToast(result.message, "error");
				(resetBtn as HTMLButtonElement).textContent = "恢复默认位置";
				(resetBtn as HTMLButtonElement).disabled = false;
			}
		});
	}
}
