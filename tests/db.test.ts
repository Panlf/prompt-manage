/**
 * Database layer tests.
 *
 * PM_DATA_DIR must be set before importing db.ts so the module uses a temp
 * directory instead of the real user data dir (and skips loading electrobun).
 */
import { describe, test, expect, beforeAll } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

process.env["PM_DATA_DIR"] = mkdtempSync(join(tmpdir(), "pm-db-test-"));

// Top-level await: import after env var is set
const db = await import("../src/bun/db");

describe("schema migration", () => {
	test("prompts table has v2 columns", () => {
		const cols = (db.db.prepare("PRAGMA table_info(prompts)").all() as { name: string }[]).map((c) => c.name);
		for (const col of ["is_favorite", "use_count", "last_used_at", "deleted_at"]) {
			expect(cols).toContain(col);
		}
	});
});

describe("prompt lifecycle", () => {
	let scenarioId: number;

	test("create scenario + prompts", () => {
		const s = db.createScenario("写作", "文案写作场景", ["营销", "文案"]);
		scenarioId = s.id;
		expect(s.tags).toEqual(["文案", "营销"]); // sorted
		db.createPrompt(scenarioId, "标题A", "内容A：写一段{{产品}}的介绍", "manual", null);
		db.createPrompt(scenarioId, "标题B", "内容B", "ai", "DeepSeek");
		expect(db.getPrompts(scenarioId)).toHaveLength(2);
	});

	test("scenario prompt_count excludes soft-deleted", () => {
		const s = db.getScenario(scenarioId)!;
		expect(s.prompt_count).toBe(2);
		const [first] = db.getPrompts(scenarioId);
		db.trashPrompt(first.id);
		expect(db.getScenario(scenarioId)!.prompt_count).toBe(1);
	});

	test("trashed prompt is hidden from active queries and listed in trash", () => {
		const active = db.getAllPrompts("updated");
		const trashed = db.getTrashedPrompts();
		expect(active.every((p) => p.deleted_at === null)).toBe(true);
		expect(trashed).toHaveLength(1);
		expect(db.getTrashedPrompts()[0].deleted_at).not.toBeNull();
	});

	test("restore brings the prompt back with its data intact", () => {
		const trashed = db.getTrashedPrompts()[0];
		const restored = db.restorePrompt(trashed.id);
		expect(restored.deleted_at).toBeNull();
		expect(db.getPrompts(scenarioId)).toHaveLength(2);
		expect(db.getTrashedPrompts()).toHaveLength(0);
	});

	test("purge permanently removes a trashed prompt", () => {
		const [first] = db.getPrompts(scenarioId);
		db.trashPrompt(first.id);
		db.purgePrompt(first.id);
		expect(db.getTrashedPrompts()).toHaveLength(0);
		expect(db.getPrompts(scenarioId)).toHaveLength(1);
	});

	test("restore on a non-trashed prompt throws", () => {
		const [first] = db.getPrompts(scenarioId);
		expect(() => db.restorePrompt(first.id)).toThrow();
	});
});

describe("favorites & usage", () => {
	test("toggle favorite flips state", () => {
		const [p] = db.getAllPrompts("updated");
		expect(p.is_favorite).toBe(0);
		const on = db.togglePromptFavorite(p.id);
		expect(on.is_favorite).toBe(1);
		const off = db.togglePromptFavorite(p.id);
		expect(off.is_favorite).toBe(0);
	});

	test("recordPromptUse increments count and sets last_used_at", () => {
		const [p] = db.getAllPrompts("updated");
		expect(p.use_count).toBe(0);
		expect(p.last_used_at).toBeNull();
		db.recordPromptUse(p.id);
		db.recordPromptUse(p.id);
		const after = db.getPrompt(p.id)!;
		expect(after.use_count).toBe(2);
		expect(after.last_used_at).not.toBeNull();
	});

	test("favorites list contains only favorites", () => {
		const all = db.getAllPrompts("updated");
		db.togglePromptFavorite(all[0].id);
		const favs = db.getFavoritePrompts();
		expect(favs).toHaveLength(1);
		expect(favs[0].is_favorite).toBe(1);
	});

	test("most_used sort orders by use_count", () => {
		const sorted = db.getAllPrompts("most_used");
		for (let i = 1; i < sorted.length; i++) {
			expect(sorted[i - 1].use_count).toBeGreaterThanOrEqual(sorted[i].use_count);
		}
	});

	test("recent prompts list only includes used ones", () => {
		const recent = db.getRecentPrompts(10);
		expect(recent.every((p) => p.last_used_at !== null)).toBe(true);
	});

	test("source filter works", () => {
		const aiOnly = db.getAllPrompts("updated", { source: "ai" });
		expect(aiOnly.every((p) => p.source === "ai")).toBe(true);
	});
});

describe("global search", () => {
	// Dedicated fixture data (lifecycle tests above purge some earlier prompts)
	beforeAll(() => {
		const s = db.createScenario("搜索场景", "专供搜索测试", ["搜索标签"]);
		db.createPrompt(s.id, "搜索标题甲", "内容：写一段{{产品}}的介绍", "manual", null);
		db.createPrompt(s.id, "Other title", "完全不同的内容", "manual", null);
	});

	test("finds prompts by title", () => {
		const r = db.searchAll("搜索标题");
		expect(r.prompts.length).toBe(1);
		expect(r.prompts[0].title).toBe("搜索标题甲");
	});

	test("finds prompts by content", () => {
		const r = db.searchAll("产品");
		expect(r.prompts.some((p) => p.content.includes("产品"))).toBe(true);
	});

	test("finds prompts by scenario tag", () => {
		const r = db.searchAll("搜索标签");
		expect(r.prompts.length).toBe(2); // both prompts in the tagged scenario
		expect(r.scenarios).toHaveLength(0);
	});

	test("escapes LIKE wildcards (literal % does not match everything)", () => {
		const r = db.searchAll("%");
		expect(r.prompts).toHaveLength(0);
		expect(r.scenarios).toHaveLength(0);
	});

	test("empty query returns empty results", () => {
		expect(db.searchAll("")).toEqual({ scenarios: [], prompts: [] });
		expect(db.searchAll("   ")).toEqual({ scenarios: [], prompts: [] });
	});
});

describe("dashboard stats", () => {
	test("counts scenarios, prompts, favorites and uses", () => {
		const stats = db.getDashboardStats();
		expect(stats.scenario_count).toBeGreaterThanOrEqual(1);
		expect(stats.prompt_count).toBeGreaterThanOrEqual(1);
		expect(stats.favorite_count).toBeGreaterThanOrEqual(1);
		expect(stats.total_uses).toBeGreaterThanOrEqual(2);
	});
});

describe("export / import", () => {
	test("roundtrip preserves data", () => {
		const json = db.exportData();
		db.importData(json);
		const stats = db.getDashboardStats();
		expect(stats.scenario_count).toBeGreaterThanOrEqual(1);
		const prompts = db.getAllPrompts("updated");
		expect(prompts.length).toBeGreaterThanOrEqual(1);
	});

	test("v1 backup (without v2 columns) still imports", () => {
		const v1 = {
			scenarios: [{ id: 90, name: "旧场景", description: "", created_at: "2025-01-01 00:00:00", updated_at: "2025-01-01 00:00:00" }],
			tags: [{ id: 90, name: "旧标签", created_at: "2025-01-01 00:00:00" }],
			scenario_tags: [{ scenario_id: 90, tag_id: 90 }],
			prompts: [
				// v1 shape: no is_favorite / use_count / last_used_at / deleted_at
				{ id: 90, scenario_id: 90, title: "旧提示词", content: "旧内容", source: "manual", model_name: null, created_at: "2025-01-01 00:00:00", updated_at: "2025-01-01 00:00:00" },
			],
			prompt_versions: [],
			precheck_runs: [],
			llm_configs: [],
		};
		db.importData(JSON.stringify(v1));
		const p = db.getPrompt(90)!;
		expect(p.title).toBe("旧提示词");
		expect(p.is_favorite).toBe(0);
		expect(p.use_count).toBe(0);
		expect(p.deleted_at).toBeNull();
	});
});

describe("empty trash", () => {
	test("emptyTrash purges all trashed prompts and returns the count", () => {
		const prompts = db.getAllPrompts("updated");
		for (const p of prompts) db.trashPrompt(p.id);
		expect(db.getTrashedPrompts().length).toBe(prompts.length);
		const purged = db.emptyTrash();
		expect(purged).toBe(prompts.length);
		expect(db.getTrashedPrompts()).toHaveLength(0);
	});
});

// Cleanup temp dir (best effort; sqlite handles are closed implicitly at exit)
describe("prompt tags", () => {
	let scenarioId: number;
	let promptA: number;
	let promptB: number;

	beforeAll(() => {
		const s = db.createScenario("标签场景", "", []);
		scenarioId = s.id;
		const a = db.createPrompt(scenarioId, "提示A", "内容A", "manual", null, ["正式", "小红书"]);
		const b = db.createPrompt(scenarioId, "提示B", "内容B", "manual", null, ["口语化"]);
		promptA = a.id;
		promptB = b.id;
	});

	test("createPrompt stores tags and getPrompt returns them", () => {
		const p = db.getPrompt(promptA)!;
		// sorted by UTF-8 code point (SQLite ORDER BY): 小 U+5C0F < 正 U+6B63
		expect(p.tags).toEqual(["小红书", "正式"]);
		expect(db.getPrompt(promptB)!.tags).toEqual(["口语化"]);
	});

	test("getPrompts fills tags for the whole list", () => {
		const list = db.getPrompts(scenarioId);
		expect(list.every((p) => Array.isArray(p.tags))).toBe(true);
		expect(list.find((p) => p.id === promptA)!.tags).toContain("小红书");
	});

	test("updatePrompt replaces tags", () => {
		db.updatePrompt(promptB, "提示B", "内容B", ["正式", "短视频"]);
		expect(db.getPrompt(promptB)!.tags).toEqual(["正式", "短视频"]);
	});

	test("updatePrompt without tags keeps existing tags", () => {
		db.updatePrompt(promptB, "提示B", "内容B-v2");
		expect(db.getPrompt(promptB)!.tags).toEqual(["正式", "短视频"]);
	});

	test("getAllPromptTags lists tags with usage counts", () => {
		const tags = db.getAllPromptTags();
		const byName = new Map(tags.map((t) => [t.name, t]));
		expect(byName.get("正式")!.count).toBe(2); // promptA + promptB
		expect(byName.get("小红书")!.count).toBe(1);
		expect(byName.get("口语化")!.count).toBe(0); // replaced on promptB
	});

	test("getAllPrompts filters by tag", () => {
		const filtered = db.getAllPrompts("updated", { tag: "小红书" });
		expect(filtered).toHaveLength(1);
		expect(filtered[0].id).toBe(promptA);
	});

	test("searchAll matches prompts by their own tags", () => {
		const r = db.searchAll("小红书");
		expect(r.prompts.some((p) => p.id === promptA)).toBe(true);
	});

	test("soft-delete keeps tags; restore brings them back", () => {
		db.trashPrompt(promptA);
		expect(db.getTrashedPrompts().find((p) => p.id === promptA)!.tags).toContain("小红书");
		const restored = db.restorePrompt(promptA);
		expect(restored.tags).toContain("小红书");
	});

	test("purge cascades the tag map rows", () => {
		db.trashPrompt(promptA);
		db.purgePrompt(promptA);
		const tags = db.getAllPromptTags();
		expect(tags.find((t) => t.name === "小红书")!.count).toBe(0);
	});

	test("export/import roundtrips prompt tags", () => {
		const json = db.exportData();
		db.importData(json);
		expect(db.getPrompt(promptB)!.tags).toEqual(["正式", "短视频"]);
	});

	test("v2 backup (no prompt_tags arrays) still imports", () => {
		const v2 = {
			scenarios: [{ id: 1, name: "s", description: "", created_at: "2025-01-01", updated_at: "2025-01-01" }],
			tags: [],
			scenario_tags: [],
			prompts: [{ id: 1, scenario_id: 1, title: "t", content: "c", source: "manual", model_name: null, created_at: "2025-01-01", updated_at: "2025-01-01" }],
			prompt_versions: [],
			precheck_runs: [],
			llm_configs: [],
		};
		db.importData(JSON.stringify(v2));
		expect(db.getPrompt(1)!.tags).toEqual([]);
	});
});

describe("v2.1.1 audit fixes", () => {
	test("searchAll returns prompt_count for scenarios", () => {
		const s = db.createScenario("计数场景", "", []);
		db.createPrompt(s.id, "计数提示词", "内容", "manual", null);
		const r = db.searchAll("计数场景");
		expect(r.scenarios).toHaveLength(1);
		expect(r.scenarios[0].prompt_count).toBe(1);
	});

	test("setPromptTags dedupes case-insensitively", () => {
		const s = db.createScenario("去重场景", "", []);
		const p = db.createPrompt(s.id, "去重提示词", "内容", "manual", null, ["Alpha", "alpha", "Beta", "Beta"]);
		expect(db.getPrompt(p.id)!.tags).toEqual(["Alpha", "Beta"]);
	});

	test("export omits api_key; import accepts both shapes", () => {
		db.createLLMConfig("密钥配置", "deepseek", "sk-audit-secret", "https://example.com/v1", "m1");
		const json = db.exportData();
		expect(json).not.toContain("sk-audit-secret");
		// re-import (without keys) still restores the config rows
		db.importData(json);
		const cfg = db.getLLMConfigs().find((c) => c.name === "密钥配置")!;
		expect(cfg.api_key).toBe("");
	});

	test("importData gives friendly errors on malformed input", () => {
		expect(() => db.importData("{oops")).toThrow(/JSON/);
		expect(() => db.importData("{}")).toThrow(/格式不正确/);
		expect(() => db.importData("null")).toThrow(/格式不正确/);
	});
});

describe("portable config resolution (外置 config.json)", () => {
	const fallback = "C:\\default\\dir";

	test("portable dataDir wins over everything", () => {
		expect(db.resolveDataDir({ dataDir: "D:\\Data" }, { customDataDir: "E:\\Old" }, fallback)).toBe("D:\\Data");
	});

	test("portable legacy customDataDir key also wins", () => {
		expect(db.resolveDataDir({ customDataDir: "D:\\Data" }, null, fallback)).toBe("D:\\Data");
	});

	test("portable without dir falls back to appdata customDataDir", () => {
		expect(db.resolveDataDir({}, { customDataDir: "E:\\Old" }, fallback)).toBe("E:\\Old");
	});

	test("blank or missing values fall through to default", () => {
		expect(db.resolveDataDir({ dataDir: "   " }, { customDataDir: "  " }, fallback)).toBe(fallback);
		expect(db.resolveDataDir(null, null, fallback)).toBe(fallback);
	});
});

afterAllCleanup();
function afterAllCleanup() {
	process.on("exit", () => {
		try {
			rmSync(process.env["PM_DATA_DIR"]!, { recursive: true, force: true });
		} catch {
			// best effort
		}
	});
}
