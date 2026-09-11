import { state, loadScenarios, loadTags, navigate, rerender, setMainContent, escapeHtml, formatDate, showToast, rpc, showConfirm, withToast, drafts } from "./core";
import type { Scenario, Tag } from "../shared/types";

let currentTag = "";
let searchQuery = "";

export async function renderScenarios() {
	await loadScenarios(currentTag || undefined);
	await loadTags();
	if (state.view !== "scenarios") return; // user navigated away while loading

	const tagsHtml = state.tags
		.map(
			(t) =>
				`<div class="tag-pill-wrapper" data-tag-name="${escapeHtml(t.name)}">
					<button class="tag-pill${currentTag === t.name ? " active" : ""}" data-tag="${escapeHtml(t.name)}">
						${escapeHtml(t.name)}<span class="tag-count">${t.count}</span>
					</button>
					<div class="tag-pill-actions">
						<button class="tag-action-btn tag-edit-btn" title="重命名标签" data-tag-id="${t.id}" data-tag-name="${escapeHtml(t.name)}">✎</button>
						<button class="tag-action-btn tag-delete-btn" title="删除标签" data-tag-id="${t.id}" data-tag-name="${escapeHtml(t.name)}">×</button>
					</div>
				</div>`,
		)
		.join("");

	setMainContent(`
		<div class="page-header">
			<h2>使用场景</h2>
			<button class="btn-primary" id="new-scenario-btn">新建场景</button>
		</div>
		<div class="filter-bar">
			<input type="text" class="search-input" id="scenario-search" placeholder="搜索场景名称或描述..." value="${escapeHtml(searchQuery)}" />
		</div>
		<div class="tag-filter">
			<button class="tag-pill${!currentTag ? " active" : ""}" data-tag="">全部</button>
			${tagsHtml}
		</div>
		<div class="scenario-grid" id="scenario-grid">
			${renderCards(getFiltered())}
		</div>
	`);
	attachListeners();
}

function getFiltered(): Scenario[] {
	const q = searchQuery.toLowerCase();
	return state.scenarios.filter(
		(s) => !q || s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q),
	);
}

function renderCards(list: Scenario[]): string {
	if (list.length === 0) {
		return `<div class="empty-state"><svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="6" width="9" height="9" rx="2"/><rect x="17" y="6" width="9" height="9" rx="2"/><rect x="6" y="17" width="9" height="9" rx="2"/><rect x="17" y="17" width="9" height="9" rx="2"/></svg>暂无使用场景，点击右上角"新建场景"开始创建</div>`;
	}
	return list.map(scenarioCard).join("");
}

function scenarioCard(s: Scenario): string {
	return `
		<div class="card scenario-card" data-id="${s.id}">
			<div class="card-header">
				<h3 class="card-title">${escapeHtml(s.name)}</h3>
				<div class="card-actions">
					<button class="icon-btn edit-scenario" data-id="${s.id}">编辑</button>
					<button class="icon-btn danger delete-scenario" data-id="${s.id}">删除</button>
				</div>
			</div>
			${s.description ? `<p class="card-desc">${escapeHtml(s.description)}</p>` : ""}
			${
				s.tags.length > 0
					? `<div class="card-tags">${s.tags.map((t) => `<span class="tag-mini">${escapeHtml(t)}</span>`).join("")}</div>`
					: ""
			}
			<div class="card-footer">
				<span class="card-meta">${s.prompt_count} 个提示词</span>
				<span class="card-meta">${formatDate(s.updated_at)}</span>
			</div>
		</div>
	`;
}

function attachListeners() {
	document.getElementById("new-scenario-btn")!.addEventListener("click", () => showScenarioModal());

	const searchInput = document.getElementById("scenario-search") as HTMLInputElement;
	searchInput.addEventListener("input", () => {
		searchQuery = searchInput.value;
		const grid = document.getElementById("scenario-grid")!;
		grid.innerHTML = renderCards(getFiltered());
		attachCardListeners();
	});

	document.querySelectorAll(".tag-pill").forEach((btn) => {
		btn.addEventListener("click", async (e) => {
			e.stopPropagation();
			currentTag = (btn as HTMLElement).dataset["tag"] || "";
			await loadScenarios(currentTag || undefined);
			rerender();
		});
	});

	document.querySelectorAll(".tag-edit-btn").forEach((btn) => {
		btn.addEventListener("click", async (e) => {
			e.stopPropagation();
			const id = parseInt((btn as HTMLElement).dataset["tagId"]!);
			const name = (btn as HTMLElement).dataset["tagName"] || "";
			const tag = state.tags.find((t) => t.id === id) || ({ id, name, count: 0 } as Tag);
			showTagRenameModal(tag);
		});
	});

	document.querySelectorAll(".tag-delete-btn").forEach((btn) => {
		btn.addEventListener("click", async (e) => {
			e.stopPropagation();
			const id = parseInt((btn as HTMLElement).dataset["tagId"]!);
			const name = (btn as HTMLElement).dataset["tagName"] || "";
			const ok = await showConfirm({
				title: `删除标签"${name}"？`,
				message: "该标签会从所有关联的使用场景中移除。",
				confirmText: "删除标签",
				danger: true,
			});
			if (!ok) return;
			try {
				await rpc().request.deleteTag({ id });
				// If we were filtering by this tag, clear the filter
				if (currentTag === name) currentTag = "";
				await loadScenarios(currentTag || undefined);
				await loadTags();
				rerender();
				showToast("标签已删除", "success");
			} catch (err) {
				showToast("删除失败: " + (err instanceof Error ? err.message : String(err)), "error");
			}
		});
	});

	attachCardListeners();
}

function attachCardListeners() {
	document.querySelectorAll(".scenario-card").forEach((card) => {
		card.addEventListener("click", (e) => {
			if ((e.target as HTMLElement).closest("button")) return;
			const id = parseInt((card as HTMLElement).dataset["id"]!);
			navigate("scenario-detail", id);
		});
	});

	document.querySelectorAll(".edit-scenario").forEach((btn) => {
		btn.addEventListener("click", (e) => {
			e.stopPropagation();
			const id = parseInt((btn as HTMLElement).dataset["id"]!);
			const scenario = state.scenarios.find((s) => s.id === id);
			if (scenario) showScenarioModal(scenario);
		});
	});

	document.querySelectorAll(".delete-scenario").forEach((btn) => {
		btn.addEventListener("click", async (e) => {
			e.stopPropagation();
			const id = parseInt((btn as HTMLElement).dataset["id"]!);
			const scenario = state.scenarios.find((s) => s.id === id);
			const ok = await showConfirm({
				title: "删除此使用场景？",
				message: `「${scenario?.name ?? "该场景"}」及其全部 ${scenario?.prompt_count ?? 0} 条提示词（包括回收站内的）将被永久删除，此操作不可撤销。`,
				confirmText: "永久删除",
				danger: true,
			});
			if (!ok) return;
			const deleted = await withToast(() => rpc().request.deleteScenario({ id }), "删除失败");
			if (!deleted) return;
			await loadScenarios(currentTag || undefined);
			await loadTags();
			rerender();
			showToast("场景已删除", "success");
		});
	});
}

/**
 * 业务弹窗通用装配：不响应遮罩点击关闭（防止误触丢失已填内容），
 * Esc = 取消。返回 close 函数。
 */
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

function showScenarioModal(scenario?: Scenario) {
	const isNew = !scenario;
	const draft = isNew ? drafts.scenario : null;
	const overlay = document.createElement("div");
	overlay.className = "modal-overlay";
	overlay.innerHTML = `
		<div class="modal">
			<h3>${scenario ? "编辑场景" : "新建使用场景"}</h3>
			<div class="form-group">
				<label>场景名称</label>
				<input type="text" id="modal-name" value="${escapeHtml(scenario ? scenario.name : draft?.name ?? "")}" placeholder="例如：文案写作" />
			</div>
			<div class="form-group">
				<label>场景描述</label>
				<textarea id="modal-desc" rows="3" placeholder="描述该场景的用途和目标">${escapeHtml(scenario ? scenario.description : draft?.description ?? "")}</textarea>
			</div>
			<div class="form-group">
				<label>标签（逗号分隔）</label>
				<input type="text" id="modal-tags" value="${escapeHtml(scenario ? scenario.tags.join(", ") : draft?.tags ?? "")}" placeholder="例如：写作, 营销, 文案" />
			</div>
			${isNew ? '<p class="form-hint">已填写的内容会自动保留，重新打开即可继续填写。</p>' : ""}
			<div class="modal-actions">
				<button class="btn-secondary" id="modal-cancel">取消</button>
				<button class="btn-primary" id="modal-save">${scenario ? "保存" : "创建"}</button>
			</div>
		</div>
	`;
	document.body.appendChild(overlay);

	const nameInput = overlay.querySelector("#modal-name") as HTMLInputElement;
	nameInput.focus();

	// 草稿实时捕获（仅新建模式）
	const captureDraft = () => {
		if (!isNew) return;
		drafts.scenario = {
			name: (overlay.querySelector("#modal-name") as HTMLInputElement).value,
			description: (overlay.querySelector("#modal-desc") as HTMLTextAreaElement).value,
			tags: (overlay.querySelector("#modal-tags") as HTMLInputElement).value,
		};
	};
	if (isNew) {
		overlay.addEventListener("input", captureDraft);
	}

	const close = () => {
		detachEsc();
		overlay.remove();
	};
	const detachEsc = setupModal(close);

	const saveBtn = overlay.querySelector("#modal-save") as HTMLButtonElement;
	const save = async () => {
		if (saveBtn.disabled) return; // 请求进行中，防双击重复创建
		const name = nameInput.value.trim();
		if (!name) {
			showToast("请输入场景名称", "error");
			return;
		}
		const desc = (overlay.querySelector("#modal-desc") as HTMLTextAreaElement).value.trim();
		const tags = (overlay.querySelector("#modal-tags") as HTMLInputElement)
			.value.split(/[,,]/)
			.map((t) => t.trim())
			.filter((t) => t);

		saveBtn.disabled = true;
		const ok = await withToast(async () => {
			if (scenario) {
				await rpc().request.updateScenario({ id: scenario.id, name, description: desc, tags });
			} else {
				await rpc().request.createScenario({ name, description: desc, tags });
			}
		}, "保存失败");
		saveBtn.disabled = false;
		if (!ok) return;
		if (isNew) drafts.scenario = null; // 保存成功才清草稿
		showToast(scenario ? "场景已更新" : "场景已创建", "success");
		close();
		await loadScenarios(currentTag || undefined);
		await loadTags();
		rerender();
	};

	overlay.querySelector("#modal-cancel")!.addEventListener("click", close);
	saveBtn.addEventListener("click", save);
	nameInput.addEventListener("keydown", (e) => {
		if (e.key === "Enter") save();
	});
}

function showTagRenameModal(tag: Tag) {
	const overlay = document.createElement("div");
	overlay.className = "modal-overlay";
	overlay.innerHTML = `
		<div class="modal">
			<h3>重命名标签</h3>
			<div class="form-group">
				<label>标签名称</label>
				<input type="text" id="tr-name" value="${escapeHtml(tag.name)}" placeholder="输入新的标签名称" />
			</div>
			<p class="form-hint">此标签已关联 ${tag.count} 个使用场景，重命名后将同步更新。</p>
			<div class="modal-actions">
				<button class="btn-secondary" id="tr-cancel">取消</button>
				<button class="btn-primary" id="tr-save">保存</button>
			</div>
		</div>
	`;
	document.body.appendChild(overlay);

	const nameInput = overlay.querySelector("#tr-name") as HTMLInputElement;
	nameInput.focus();
	nameInput.select();

	const close = () => {
		detachEsc();
		overlay.remove();
	};
	const detachEsc = setupModal(close);

	const save = async () => {
		const newName = nameInput.value.trim();
		if (!newName) {
			showToast("请输入标签名称", "error");
			return;
		}
		try {
			await rpc().request.renameTag({ id: tag.id, name: newName });
			// If we were filtering by the old name, update to the new name
			if (currentTag === tag.name) currentTag = newName;
			close();
			await loadScenarios(currentTag || undefined);
			await loadTags();
			rerender();
			showToast("标签已更新", "success");
		} catch (err) {
			showToast("更新失败: " + (err instanceof Error ? err.message : String(err)), "error");
		}
	};

	overlay.querySelector("#tr-cancel")!.addEventListener("click", close);
	overlay.querySelector("#tr-save")!.addEventListener("click", save);
	nameInput.addEventListener("keydown", (e) => {
		if (e.key === "Enter") save();
	});
}
