import { state, setMainContent, rpc, escapeHtml, formatDate, showToast, rerender, showConfirm } from "./core";
import { ICONS } from "./components";
import type { PromptWithScenario } from "../shared/types";

export async function renderTrash() {
	const prompts: PromptWithScenario[] = await rpc().request.getTrashedPrompts({});
	if (state.view !== "trash") return; // user navigated away while loading

	setMainContent(`
		<div class="page-header">
			<h2>回收站</h2>
			<div class="page-header-right">
				${prompts.length > 0 ? `<button class="btn-secondary danger" id="empty-trash-btn">清空回收站</button>` : ""}
			</div>
		</div>
		<div class="info-banner">
			删除的提示词会保留在回收站中，可随时恢复。注意：删除整个使用场景时，其中的提示词（包括回收站内的）会被永久删除。
		</div>
		<div class="trash-list" id="trash-list">
			${
				prompts.length > 0
					? prompts.map(trashRow).join("")
					: `<div class="empty-state">
							${ICONS.trash}
							回收站是空的
						</div>`
			}
		</div>
	`);

	if (prompts.length === 0) return;

	// Restore / purge per row
	document.querySelectorAll<HTMLElement>(".trash-row").forEach((row) => {
		const id = parseInt(row.dataset["id"]!);
		row.querySelector('[data-action="restore"]')!.addEventListener("click", async () => {
			try {
				await rpc().request.restorePrompt({ id });
				showToast("已恢复到原场景", "success");
				rerender();
			} catch (err) {
				showToast("恢复失败: " + (err instanceof Error ? err.message : String(err)), "error");
			}
		});
		row.querySelector('[data-action="purge"]')!.addEventListener("click", async () => {
			const ok = await showConfirm({
				title: "彻底删除提示词？",
				message: "此操作不可撤销，该提示词及其版本历史将被永久删除。",
				confirmText: "彻底删除",
				danger: true,
			});
			if (!ok) return;
			try {
				await rpc().request.purgePrompt({ id });
				showToast("已彻底删除", "success");
				rerender();
			} catch (err) {
				showToast("删除失败: " + (err instanceof Error ? err.message : String(err)), "error");
			}
		});
	});

	// Empty trash
	document.getElementById("empty-trash-btn")?.addEventListener("click", async () => {
		const ok = await showConfirm({
			title: "清空回收站？",
			message: `将永久删除回收站中的 ${prompts.length} 条提示词，此操作不可撤销。`,
			confirmText: "清空回收站",
			danger: true,
		});
		if (!ok) return;
		try {
			const result = await rpc().request.emptyTrash({});
			showToast(`已清空回收站（${result.purged} 条）`, "success");
			rerender();
		} catch (err) {
			showToast("操作失败: " + (err instanceof Error ? err.message : String(err)), "error");
		}
	});
}

function trashRow(p: PromptWithScenario): string {
	return `
		<div class="card trash-row" data-id="${p.id}">
			<div class="trash-row-main">
				<div class="trash-row-title">
					${escapeHtml(p.title)}
					${p.source === "ai" ? '<span class="source-badge source-ai">AI</span>' : ""}
				</div>
				<p class="prompt-preview">${escapeHtml(p.content)}</p>
			</div>
			<div class="trash-row-side">
				<span class="card-meta">来自：${escapeHtml(p.scenario_name)}</span>
				<span class="card-meta">删除于 ${formatDate(p.deleted_at)}</span>
				<div class="trash-row-actions">
					<button class="btn-small" data-action="restore">恢复</button>
					<button class="btn-small danger" data-action="purge">彻底删除</button>
				</div>
			</div>
		</div>
	`;
}
