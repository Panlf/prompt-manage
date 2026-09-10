import Database from "bun:sqlite";
import { join, dirname } from "path";
import { mkdirSync, existsSync, readFileSync, writeFileSync, copyFileSync, readdirSync, unlinkSync } from "fs";
import { Utils } from "electrobun/bun";
import type {
	Scenario,
	Tag,
	Prompt,
	PromptVersion,
	PrecheckRun,
	LLMConfig,
	ExportData,
	PromptWithScenario,
	SearchResults,
	DashboardStats,
	PromptSort,
} from "../shared/types";

// ---- Config: 数据存储路径解析 ----
// 优先级（高 → 低）：
//   1. PM_DATA_DIR 环境变量（仅自动化测试注入）
//   2. 便携配置 bin/config.json（与 PromptHub.exe 同目录，可手动编辑；
//      升级时"覆盖解压"不会删除它——zip 里没有这个文件）
//   3. AppData config.json（应用内"数据管理→迁移"维护，位于用户目录，升级天然保留）
//   4. 默认 %LOCALAPPDATA%\promptmanage.app\stable
function resolveDefaultDataDir(): string {
	const envDir = process.env["PM_DATA_DIR"];
	if (envDir) return envDir;
	return Utils.paths.userData;
}

type DirConfig = { dataDir?: string; customDataDir?: string };

const defaultDataDir = resolveDefaultDataDir();
if (!existsSync(defaultDataDir)) {
	mkdirSync(defaultDataDir, { recursive: true });
}

// bun.exe 所在目录（打包后与 PromptHub.exe 同级）
const portableConfigPath = join(dirname(process.execPath), "config.json");
const appDataConfigPath = join(defaultDataDir, "config.json");

function readConfigFile(path: string): DirConfig {
	try {
		if (existsSync(path)) {
			const parsed = JSON.parse(readFileSync(path, "utf-8"));
			if (parsed && typeof parsed === "object") return parsed as DirConfig;
		}
	} catch {}
	return {};
}

/** 按优先级解析数据目录。独立导出以便单元测试。 */
export function resolveDataDir(portable: DirConfig | null, appData: DirConfig | null, fallback: string): string {
	const fromPortable = portable?.dataDir?.trim() || portable?.customDataDir?.trim();
	if (fromPortable) return fromPortable;
	const fromAppData = appData?.customDataDir?.trim();
	if (fromAppData) return fromAppData;
	return fallback;
}

const portableConfig = readConfigFile(portableConfigPath);
const appDataConfig = readConfigFile(appDataConfigPath);
// 哪个配置文件"生效"（应用内迁移时应写回它）
const configSource: "portable" | "appdata" =
	portableConfig.dataDir?.trim() || portableConfig.customDataDir?.trim() ? "portable" : "appdata";

const dataDir = resolveDataDir(portableConfig, appDataConfig, defaultDataDir);
if (!existsSync(dataDir)) {
	mkdirSync(dataDir, { recursive: true });
}
const dbPath = join(dataDir, "prompt-manage.db");

export const db = new Database(dbPath, { create: true });
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

// ---- Schema ----
db.exec(`
	CREATE TABLE IF NOT EXISTS scenarios (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL,
		description TEXT DEFAULT '',
		created_at TEXT NOT NULL DEFAULT (datetime('now')),
		updated_at TEXT NOT NULL DEFAULT (datetime('now'))
	);

	CREATE TABLE IF NOT EXISTS tags (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL UNIQUE,
		created_at TEXT NOT NULL DEFAULT (datetime('now'))
	);

	CREATE TABLE IF NOT EXISTS scenario_tags (
		scenario_id INTEGER NOT NULL,
		tag_id INTEGER NOT NULL,
		PRIMARY KEY (scenario_id, tag_id),
		FOREIGN KEY (scenario_id) REFERENCES scenarios(id) ON DELETE CASCADE,
		FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
	);

	CREATE TABLE IF NOT EXISTS prompt_tags (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL UNIQUE,
		created_at TEXT NOT NULL DEFAULT (datetime('now'))
	);

	CREATE TABLE IF NOT EXISTS prompt_tag_map (
		prompt_id INTEGER NOT NULL,
		tag_id INTEGER NOT NULL,
		PRIMARY KEY (prompt_id, tag_id),
		FOREIGN KEY (prompt_id) REFERENCES prompts(id) ON DELETE CASCADE,
		FOREIGN KEY (tag_id) REFERENCES prompt_tags(id) ON DELETE CASCADE
	);

	CREATE TABLE IF NOT EXISTS prompts (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		scenario_id INTEGER NOT NULL,
		title TEXT NOT NULL,
		content TEXT NOT NULL,
		source TEXT NOT NULL DEFAULT 'manual',
		model_name TEXT,
		created_at TEXT NOT NULL DEFAULT (datetime('now')),
		updated_at TEXT NOT NULL DEFAULT (datetime('now')),
		FOREIGN KEY (scenario_id) REFERENCES scenarios(id) ON DELETE CASCADE
	);

	CREATE TABLE IF NOT EXISTS prompt_versions (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		prompt_id INTEGER NOT NULL,
		version_number INTEGER NOT NULL,
		content TEXT NOT NULL,
		note TEXT DEFAULT '',
		created_at TEXT NOT NULL DEFAULT (datetime('now')),
		FOREIGN KEY (prompt_id) REFERENCES prompts(id) ON DELETE CASCADE
	);

	CREATE TABLE IF NOT EXISTS precheck_runs (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		prompt_id INTEGER NOT NULL,
		type TEXT NOT NULL,
		input_text TEXT DEFAULT '',
		output_text TEXT NOT NULL,
		model_name TEXT NOT NULL,
		created_at TEXT NOT NULL DEFAULT (datetime('now')),
		FOREIGN KEY (prompt_id) REFERENCES prompts(id) ON DELETE CASCADE
	);

	CREATE TABLE IF NOT EXISTS llm_configs (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL,
		provider TEXT NOT NULL,
		api_key TEXT DEFAULT '',
		base_url TEXT NOT NULL,
		model TEXT NOT NULL,
		is_active INTEGER NOT NULL DEFAULT 0,
		created_at TEXT NOT NULL DEFAULT (datetime('now'))
	);

	CREATE TABLE IF NOT EXISTS app_prefs (
		key TEXT PRIMARY KEY,
		value TEXT NOT NULL
	);
`);

// ---- Lightweight column migration (v1.x -> v2.0) ----
// Adds favorite / usage-stat / soft-delete columns without touching existing data.
function migrateColumns() {
	const existing = new Set(
		(db.prepare("PRAGMA table_info(prompts)").all() as any[]).map((c) => c.name),
	);
	const additions: [string, string][] = [
		["is_favorite", "INTEGER NOT NULL DEFAULT 0"],
		["use_count", "INTEGER NOT NULL DEFAULT 0"],
		["last_used_at", "TEXT"],
		["deleted_at", "TEXT"],
	];
	for (const [col, ddl] of additions) {
		if (!existing.has(col)) {
			db.prepare(`ALTER TABLE prompts ADD COLUMN ${col} ${ddl}`).run();
		}
	}
}
migrateColumns();

export function getDbPath(): string {
	return dbPath;
}

export function getDataDir(): string {
	return dataDir;
}

export function getDefaultDataDir(): string {
	return defaultDataDir;
}

export function getCustomDataDir(): string | null {
	return dataDir !== defaultDataDir ? dataDir : null;
}

/** 当前生效的配置文件来源：portable（exe 旁 config.json）或 appdata（AppData config.json）。 */
export function getConfigSource(): "portable" | "appdata" {
	return configSource;
}

export function getPortableConfigPath(): string {
	return portableConfigPath;
}

/** 校验数据目录是否可用（存在/可创建/可写），不执行迁移。供 UI"检查路径"使用。 */
export function validateDataDir(dir: string): { ok: boolean; message: string } {
	const trimmed = dir.trim();
	if (!trimmed) return { ok: false, message: "路径不能为空" };
	try {
		let created = false;
		if (!existsSync(trimmed)) {
			mkdirSync(trimmed, { recursive: true });
			created = true;
		}
		const probe = join(trimmed, ".write-probe");
		writeFileSync(probe, "ok");
		unlinkSync(probe);
		return { ok: true, message: created ? "目录不存在，已自动创建，可正常使用" : "目录存在且可写" };
	} catch (err) {
		const detail = err instanceof Error ? err.message : String(err);
		return { ok: false, message: `目录不可用：${detail}` };
	}
}

/**
 * 迁移数据到新目录：
 * 1. 关闭当前数据库连接
 * 2. 复制 .db 及 WAL/SHM 文件到新目录
 * 3. 更新配置文件
 * 4. 返回新路径（应用需要重启才能重新连接）
 */
export function migrateDataDir(newDir: string): string {
	const trimmed = newDir.trim();
	if (!trimmed) throw new Error("新路径不能为空");
	if (trimmed === dataDir) throw new Error("新路径与当前路径相同");

	// 准备目标目录并预检可写——任何失败都给出友好提示，
	// 且此时数据库连接从未被触碰，应用可继续正常使用
	const probePath = join(trimmed, ".write-probe");
	try {
		if (!existsSync(trimmed)) {
			mkdirSync(trimmed, { recursive: true });
		}
		writeFileSync(probePath, "ok");
		unlinkSync(probePath);
	} catch (err) {
		const detail = err instanceof Error ? err.message : String(err);
		throw new Error(`无法使用目标目录（${detail}）：${trimmed}`);
	}

	// 先把 WAL 合并进主库文件再复制——全程不关闭连接，
	// 复制中途失败只影响新目录，当前应用数据不受任何影响
	db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
	const filesToCopy = readdirSync(dataDir).filter((f) => f.startsWith("prompt-manage.db"));
	for (const file of filesToCopy) {
		copyFileSync(join(dataDir, file), join(trimmed, file));
	}

	// 把新路径写回"生效中"的配置文件（便携 config.json 或 AppData config.json）
	const activeConfig = configSource === "portable" ? portableConfig : appDataConfig;
	const activeConfigPath = configSource === "portable" ? portableConfigPath : appDataConfigPath;
	const updatedConfig: DirConfig =
		configSource === "portable" ? { ...activeConfig, dataDir: trimmed } : { ...activeConfig, customDataDir: trimmed };
	writeFileSync(activeConfigPath, JSON.stringify(updatedConfig, null, 2));

	return join(trimmed, "prompt-manage.db");
}

// ---- Scenario queries ----

export function getScenarios(tag?: string): Scenario[] {
	let query = `
		SELECT s.*, COUNT(DISTINCT p.id) as prompt_count
		FROM scenarios s
		LEFT JOIN prompts p ON p.scenario_id = s.id AND p.deleted_at IS NULL
	`;
	const params: string[] = [];
	if (tag) {
		query += `
			JOIN scenario_tags st ON st.scenario_id = s.id
			JOIN tags t ON t.id = st.tag_id AND t.name = ?
		`;
		params.push(tag);
	}
	query += ` GROUP BY s.id ORDER BY s.updated_at DESC`;

	const rows = (params.length ? db.prepare(query).all(...params) : db.prepare(query).all()) as any[];
	return rows.map((r) => ({
		...r,
		tags: getTagsForScenario(r.id),
	}));
}

export function getScenario(id: number): Scenario | null {
	const row = db.prepare("SELECT * FROM scenarios WHERE id = ?").get(id) as any;
	if (!row) return null;
	const count = db
		.prepare("SELECT COUNT(*) as c FROM prompts WHERE scenario_id = ? AND deleted_at IS NULL")
		.get(id) as any;
	return { ...row, tags: getTagsForScenario(id), prompt_count: count?.c || 0 };
}

export function createScenario(name: string, description: string, tags: string[]): Scenario {
	const tx = db.transaction(() => {
		const result = db.prepare("INSERT INTO scenarios (name, description) VALUES (?, ?) RETURNING *").get(name, description) as any;
		const scenarioId = result.id;
		for (const tagName of tags) {
			const trimmed = tagName.trim();
			if (!trimmed) continue;
			// Insert tag if not exists
			db.prepare("INSERT OR IGNORE INTO tags (name) VALUES (?)").run(trimmed);
			const tag = db.prepare("SELECT id FROM tags WHERE name = ?").get(trimmed) as any;
			db.prepare("INSERT OR IGNORE INTO scenario_tags (scenario_id, tag_id) VALUES (?, ?)").run(scenarioId, tag.id);
		}
		return result;
	});
	const row = tx();
	return { ...row, tags: getTagsForScenario(row.id), prompt_count: 0 };
}

export function updateScenario(id: number, name: string, description: string, tags: string[]): Scenario {
	const tx = db.transaction(() => {
		const row = db.prepare("UPDATE scenarios SET name = ?, description = ?, updated_at = datetime('now') WHERE id = ? RETURNING *").get(name, description, id) as any;
		// Clear existing tags
		db.prepare("DELETE FROM scenario_tags WHERE scenario_id = ?").run(id);
		for (const tagName of tags) {
			const trimmed = tagName.trim();
			if (!trimmed) continue;
			db.prepare("INSERT OR IGNORE INTO tags (name) VALUES (?)").run(trimmed);
			const tag = db.prepare("SELECT id FROM tags WHERE name = ?").get(trimmed) as any;
			db.prepare("INSERT OR IGNORE INTO scenario_tags (scenario_id, tag_id) VALUES (?, ?)").run(id, tag.id);
		}
		return row;
	});
	const row = tx();
	return { ...row, tags: getTagsForScenario(id), prompt_count: 0 };
}

export function deleteScenario(id: number): void {
	db.prepare("DELETE FROM scenarios WHERE id = ?").run(id);
}

// ---- Tag queries ----

export function getAllTags(): Tag[] {
	const rows = db.prepare(`
		SELECT t.id, t.name, COUNT(st.scenario_id) as count
		FROM tags t
		LEFT JOIN scenario_tags st ON st.tag_id = t.id
		GROUP BY t.id
		ORDER BY t.name
	`).all() as any[];
	return rows;
}

export function getTagsForScenario(scenarioId: number): string[] {
	const rows = db.prepare(`
		SELECT t.name FROM tags t
		JOIN scenario_tags st ON st.tag_id = t.id
		WHERE st.scenario_id = ?
		ORDER BY t.name
	`).all(scenarioId) as any[];
	return rows.map((r) => r.name);
}

export function renameTag(id: number, newName: string): Tag {
	const trimmed = newName.trim();
	if (!trimmed) throw new Error("标签名称不能为空");
	// Check for duplicate name (case-insensitive collision)
	const existing = db.prepare("SELECT id FROM tags WHERE LOWER(name) = LOWER(?) AND id != ?").get(trimmed, id) as any;
	if (existing) throw new Error(`标签名称 "${trimmed}" 已存在`);
	const row = db.prepare("UPDATE tags SET name = ? WHERE id = ? RETURNING *").get(trimmed, id) as any;
	if (!row) throw new Error("标签不存在");
	const count = db.prepare("SELECT COUNT(*) as c FROM scenario_tags WHERE tag_id = ?").get(id) as any;
	return { id: row.id, name: row.name, count: count?.c || 0 };
}

export function deleteTag(id: number): void {
	const result = db.prepare("DELETE FROM tags WHERE id = ?").run(id);
	if (result.changes === 0) throw new Error("标签不存在");
}

// ---- Prompt-level tags ----

export function getPromptTags(promptId: number): string[] {
	const rows = db.prepare(`
		SELECT t.name FROM prompt_tags t
		JOIN prompt_tag_map m ON m.tag_id = t.id
		WHERE m.prompt_id = ?
		ORDER BY t.name
	`).all(promptId) as any[];
	return rows.map((r) => r.name);
}

/** Batch-load tags for many prompts: promptId -> tag names. */
function loadPromptTags(promptIds: number[]): Map<number, string[]> {
	const result = new Map<number, string[]>();
	if (promptIds.length === 0) return result;
	const placeholders = promptIds.map(() => "?").join(",");
	const rows = db.prepare(`
		SELECT m.prompt_id, t.name FROM prompt_tag_map m
		JOIN prompt_tags t ON t.id = m.tag_id
		WHERE m.prompt_id IN (${placeholders})
		ORDER BY t.name
	`).all(...promptIds) as any[];
	for (const r of rows) {
		const list = result.get(r.prompt_id) ?? [];
		list.push(r.name);
		result.set(r.prompt_id, list);
	}
	return result;
}

/** Replace a prompt's tags (create tag rows as needed). */
function setPromptTags(promptId: number, tags: string[]) {
	db.transaction(() => {
		db.prepare("DELETE FROM prompt_tag_map WHERE prompt_id = ?").run(promptId);
		const seen = new Set<string>();
		for (const tagName of tags) {
			const trimmed = tagName.trim();
			if (!trimmed) continue;
			// Case-insensitive dedupe: "正式" 与 "正式" 视为同一标签
			const key = trimmed.toLowerCase();
			if (seen.has(key)) continue;
			seen.add(key);
			db.prepare("INSERT OR IGNORE INTO prompt_tags (name) VALUES (?)").run(trimmed);
			const tag = db.prepare("SELECT id FROM prompt_tags WHERE LOWER(name) = LOWER(?)").get(trimmed) as any;
			db.prepare("INSERT OR IGNORE INTO prompt_tag_map (prompt_id, tag_id) VALUES (?, ?)").run(promptId, tag.id);
		}
	})();
}

/** All prompt-level tags with usage counts. */
export function getAllPromptTags(): Tag[] {
	return db.prepare(`
		SELECT t.id, t.name, COUNT(m.prompt_id) as count
		FROM prompt_tags t
		LEFT JOIN prompt_tag_map m ON m.tag_id = t.id
		GROUP BY t.id
		ORDER BY t.name
	`).all() as Tag[];
}

// ---- Prompt queries ----

export function getPrompts(scenarioId: number): Prompt[] {
	const rows = db
		.prepare("SELECT * FROM prompts WHERE scenario_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC")
		.all(scenarioId) as any[];
	const tags = loadPromptTags(rows.map((r) => r.id));
	return rows.map((r) => ({ ...r, tags: tags.get(r.id) ?? [] }));
}

export function getPrompt(id: number): Prompt | null {
	const row = db.prepare("SELECT * FROM prompts WHERE id = ? AND deleted_at IS NULL").get(id) as any;
	if (!row) return null;
	return { ...row, tags: getPromptTags(id) };
}

export function createPrompt(scenarioId: number, title: string, content: string, source: string, modelName: string | null, tags?: string[]): Prompt {
	const row = db.prepare("INSERT INTO prompts (scenario_id, title, content, source, model_name) VALUES (?, ?, ?, ?, ?) RETURNING *").get(scenarioId, title, content, source, modelName) as any;
	if (tags) setPromptTags(row.id, tags);
	// Update scenario updated_at
	db.prepare("UPDATE scenarios SET updated_at = datetime('now') WHERE id = ?").run(scenarioId);
	return { ...row, tags: getPromptTags(row.id) };
}

export function updatePrompt(id: number, title: string, content: string, tags?: string[]): Prompt {
	const tx = db.transaction(() => {
		// Save current version before updating
		const current = db.prepare("SELECT * FROM prompts WHERE id = ?").get(id) as any;
		if (current && current.content !== content) {
			const maxVersion = db.prepare("SELECT MAX(version_number) as max FROM prompt_versions WHERE prompt_id = ?").get(id) as any;
			const nextVersion = (maxVersion?.max || 0) + 1;
			db.prepare("INSERT INTO prompt_versions (prompt_id, version_number, content, note) VALUES (?, ?, ?, ?)").run(id, nextVersion, current.content, "auto-saved before edit");
		}
		const row = db.prepare("UPDATE prompts SET title = ?, content = ?, updated_at = datetime('now') WHERE id = ? RETURNING *").get(title, content, id) as any;
		if (tags !== undefined) setPromptTags(id, tags);
		db.prepare("UPDATE scenarios SET updated_at = datetime('now') WHERE id = ?").run(current.scenario_id);
		return row;
	});
	const row = tx();
	return { ...row, tags: getPromptTags(id) };
}

/** Soft-delete: move to trash (deleted_at set). */
export function trashPrompt(id: number): void {
	db.prepare("UPDATE prompts SET deleted_at = datetime('now') WHERE id = ? AND deleted_at IS NULL").run(id);
}

/** Restore a trashed prompt back to its scenario. */
export function restorePrompt(id: number): Prompt {
	const row = db
		.prepare("UPDATE prompts SET deleted_at = NULL, updated_at = datetime('now') WHERE id = ? AND deleted_at IS NOT NULL RETURNING *")
		.get(id) as any;
	if (!row) throw new Error("回收站中不存在该提示词");
	return { ...row, tags: getPromptTags(id) };
}

/** Permanently delete a single trashed prompt. */
export function purgePrompt(id: number): void {
	const result = db.prepare("DELETE FROM prompts WHERE id = ? AND deleted_at IS NOT NULL").run(id);
	if (result.changes === 0) throw new Error("回收站中不存在该提示词");
}

/** Permanently delete every trashed prompt. Returns the number purged. */
export function emptyTrash(): number {
	return db.prepare("DELETE FROM prompts WHERE deleted_at IS NOT NULL").run().changes;
}

export function getTrashedPrompts(): PromptWithScenario[] {
	const rows = db
		.prepare(`
			SELECT p.*, s.name as scenario_name
			FROM prompts p JOIN scenarios s ON s.id = p.scenario_id
			WHERE p.deleted_at IS NOT NULL
			ORDER BY p.deleted_at DESC
		`)
		.all() as any[];
	const tags = loadPromptTags(rows.map((r) => r.id));
	return rows.map((r) => ({ ...r, tags: tags.get(r.id) ?? [] }));
}

// ---- Favorites & usage stats ----

export function togglePromptFavorite(id: number): Prompt {
	const row = db
		.prepare("UPDATE prompts SET is_favorite = 1 - is_favorite WHERE id = ? AND deleted_at IS NULL RETURNING *")
		.get(id) as any;
	if (!row) throw new Error("提示词不存在");
	return { ...row, tags: getPromptTags(id) };
}

/** Record a "use" (copy) event for a prompt. */
export function recordPromptUse(id: number): void {
	db.prepare("UPDATE prompts SET use_count = use_count + 1, last_used_at = datetime('now') WHERE id = ? AND deleted_at IS NULL").run(id);
}

export function getFavoritePrompts(): PromptWithScenario[] {
	const rows = db
		.prepare(`
			SELECT p.*, s.name as scenario_name
			FROM prompts p JOIN scenarios s ON s.id = p.scenario_id
			WHERE p.deleted_at IS NULL AND p.is_favorite = 1
			ORDER BY COALESCE(p.last_used_at, p.updated_at) DESC
		`)
		.all() as any[];
	const tags = loadPromptTags(rows.map((r) => r.id));
	return rows.map((r) => ({ ...r, tags: tags.get(r.id) ?? [] }));
}

// 全部提示词页三个 Tab 的取数规则：每个 Tab 固定只取前 6 条；
// 最近使用/最常用只统计复制过的提示词，没复制过的不进入这两个 Tab
const SORT_RULES: Record<PromptSort, { where?: string; order: string }> = {
	recent: { where: "p.last_used_at IS NOT NULL", order: "p.last_used_at DESC, p.updated_at DESC" },
	most_used: { where: "p.use_count > 0", order: "p.use_count DESC, p.last_used_at DESC, p.updated_at DESC" },
	updated: { order: "p.updated_at DESC" },
};

export function getAllPrompts(
	sort: PromptSort,
	opts?: { favorite?: boolean; source?: string; tag?: string },
): PromptWithScenario[] {
	const rules = SORT_RULES[sort] ?? SORT_RULES.updated;
	const conditions = ["p.deleted_at IS NULL"];
	if (rules.where) conditions.push(rules.where);
	const params: any[] = [];
	if (opts?.favorite) {
		conditions.push("p.is_favorite = 1");
	}
	if (opts?.source) {
		conditions.push("p.source = ?");
		params.push(opts.source);
	}
	if (opts?.tag) {
		conditions.push(`
			EXISTS (
				SELECT 1 FROM prompt_tag_map m JOIN prompt_tags t ON t.id = m.tag_id
				WHERE m.prompt_id = p.id AND t.name = ?
			)
		`);
		params.push(opts.tag);
	}
	const sql = `
		SELECT p.*, s.name as scenario_name
		FROM prompts p JOIN scenarios s ON s.id = p.scenario_id
		WHERE ${conditions.join(" AND ")}
		ORDER BY ${rules.order}
		LIMIT 6
	`;
	const rows = db.prepare(sql).all(...params) as any[];
	const tags = loadPromptTags(rows.map((r) => r.id));
	return rows.map((r) => ({ ...r, tags: tags.get(r.id) ?? [] }));
}

export function getRecentPrompts(limit: number): PromptWithScenario[] {
	const rows = db
		.prepare(`
			SELECT p.*, s.name as scenario_name
			FROM prompts p JOIN scenarios s ON s.id = p.scenario_id
			WHERE p.deleted_at IS NULL AND p.last_used_at IS NOT NULL
			ORDER BY p.last_used_at DESC
			LIMIT ?
		`)
		.all(limit) as any[];
	const tags = loadPromptTags(rows.map((r) => r.id));
	return rows.map((r) => ({ ...r, tags: tags.get(r.id) ?? [] }));
}

export function getDashboardStats(): DashboardStats {
	const count = (sql: string) => (db.prepare(sql).get() as any).c;
	return {
		scenario_count: count("SELECT COUNT(*) as c FROM scenarios"),
		prompt_count: count("SELECT COUNT(*) as c FROM prompts WHERE deleted_at IS NULL"),
		favorite_count: count("SELECT COUNT(*) as c FROM prompts WHERE deleted_at IS NULL AND is_favorite = 1"),
		total_uses: count("SELECT COALESCE(SUM(use_count), 0) as c FROM prompts WHERE deleted_at IS NULL"),
	};
}

// ---- Global search ----

function likeEscape(term: string): string {
	return term.replace(/[\\%_]/g, (c) => "\\" + c);
}

/**
 * Search scenarios (name/description) and active prompts (title/content)
 * plus prompt tags, all case-insensitively.
 */
export function searchAll(query: string): SearchResults {
	const term = query.trim();
	if (!term) return { scenarios: [], prompts: [] };
	const p = `%${likeEscape(term)}%`;

	const scenarioRows = db
		.prepare(
			`SELECT s.*,
				(SELECT COUNT(*) FROM prompts p WHERE p.scenario_id = s.id AND p.deleted_at IS NULL) as prompt_count
			 FROM scenarios s
			 WHERE s.name LIKE ? ESCAPE '\\' OR s.description LIKE ? ESCAPE '\\'
			 ORDER BY s.updated_at DESC
			 LIMIT 6`,
		)
		.all(p, p) as any[];

	const promptRows = db
		.prepare(
			`SELECT p.*, s.name as scenario_name
			 FROM prompts p
			 JOIN scenarios s ON s.id = p.scenario_id
			 WHERE p.deleted_at IS NULL AND (
				p.title LIKE ? ESCAPE '\\' OR p.content LIKE ? ESCAPE '\\'
				OR EXISTS (
					SELECT 1 FROM scenario_tags st JOIN tags t ON t.id = st.tag_id
					WHERE st.scenario_id = p.scenario_id AND t.name LIKE ? ESCAPE '\\'
				)
				OR EXISTS (
					SELECT 1 FROM prompt_tag_map m JOIN prompt_tags pt ON pt.id = m.tag_id
					WHERE m.prompt_id = p.id AND pt.name LIKE ? ESCAPE '\\'
				)
			 )
			 ORDER BY p.updated_at DESC
			 LIMIT 6`,
		)
		.all(p, p, p, p) as any[];
	const tags = loadPromptTags(promptRows.map((r) => r.id));

	return {
		scenarios: scenarioRows.map((r) => ({ ...r, tags: getTagsForScenario(r.id) })),
		prompts: promptRows.map((r) => ({ ...r, tags: tags.get(r.id) ?? [] })),
	};
}

// ---- Prompt version queries ----

export function getPromptVersions(promptId: number): PromptVersion[] {
	return db.prepare("SELECT * FROM prompt_versions WHERE prompt_id = ? ORDER BY version_number DESC").all(promptId) as PromptVersion[];
}

export function savePromptVersion(promptId: number, content: string, note: string): PromptVersion {
	const maxVersion = db.prepare("SELECT MAX(version_number) as max FROM prompt_versions WHERE prompt_id = ?").get(promptId) as any;
	const nextVersion = (maxVersion?.max || 0) + 1;
	return db.prepare("INSERT INTO prompt_versions (prompt_id, version_number, content, note) VALUES (?, ?, ?, ?) RETURNING *").get(promptId, nextVersion, content, note) as PromptVersion;
}

// ---- Precheck queries ----

export function getPrecheckRuns(promptId: number): PrecheckRun[] {
	return db.prepare("SELECT * FROM precheck_runs WHERE prompt_id = ? ORDER BY created_at DESC").all(promptId) as PrecheckRun[];
}

export function savePrecheckRun(promptId: number, type: string, inputText: string, outputText: string, modelName: string): PrecheckRun {
	return db.prepare("INSERT INTO precheck_runs (prompt_id, type, input_text, output_text, model_name) VALUES (?, ?, ?, ?, ?) RETURNING *").get(promptId, type, inputText, outputText, modelName) as PrecheckRun;
}

// ---- LLM config queries ----

export function getLLMConfigs(): LLMConfig[] {
	return db.prepare("SELECT * FROM llm_configs ORDER BY created_at DESC").all() as LLMConfig[];
}

export function getActiveLLMConfig(): LLMConfig | null {
	return (db.prepare("SELECT * FROM llm_configs WHERE is_active = 1 LIMIT 1").get() as LLMConfig) || null;
}

export function getLLMConfig(id: number): LLMConfig | null {
	return (db.prepare("SELECT * FROM llm_configs WHERE id = ?").get(id) as LLMConfig) || null;
}

export function createLLMConfig(name: string, provider: string, apiKey: string, baseUrl: string, model: string): LLMConfig {
	return db.prepare("INSERT INTO llm_configs (name, provider, api_key, base_url, model) VALUES (?, ?, ?, ?, ?) RETURNING *").get(name, provider, apiKey, baseUrl, model) as LLMConfig;
}

export function updateLLMConfig(id: number, name: string, provider: string, apiKey: string, baseUrl: string, model: string): LLMConfig {
	return db.prepare("UPDATE llm_configs SET name = ?, provider = ?, api_key = ?, base_url = ?, model = ? WHERE id = ? RETURNING *").get(name, provider, apiKey, baseUrl, model, id) as LLMConfig;
}

export function deleteLLMConfig(id: number): void {
	db.prepare("DELETE FROM llm_configs WHERE id = ?").run(id);
}

export function setActiveLLMConfig(id: number): void {
	db.transaction(() => {
		db.prepare("UPDATE llm_configs SET is_active = 0").run();
		db.prepare("UPDATE llm_configs SET is_active = 1 WHERE id = ?").run(id);
	})();
}

// ---- UI prefs（主题色等界面偏好，存库以便重启后保留） ----

export function getPref(key: string): string | null {
	const row = db.prepare("SELECT value FROM app_prefs WHERE key = ?").get(key) as any;
	return row?.value ?? null;
}

export function setPref(key: string, value: string): void {
	db.prepare(
		"INSERT INTO app_prefs (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
	).run(key, value);
}

// ---- Export / Import ----

export function exportData(): string {
	const data: ExportData = {
		scenarios: db.prepare("SELECT id, name, description, created_at, updated_at FROM scenarios").all() as any[],
		tags: db.prepare("SELECT id, name, created_at FROM tags").all() as any[],
		scenario_tags: db.prepare("SELECT scenario_id, tag_id FROM scenario_tags").all() as any[],
		prompts: db.prepare("SELECT * FROM prompts").all() as Prompt[],
		prompt_versions: db.prepare("SELECT * FROM prompt_versions").all() as PromptVersion[],
		precheck_runs: db.prepare("SELECT * FROM precheck_runs").all() as PrecheckRun[],
		// api_key 有意不导出：备份文件常被分享/同步，明文密钥会随之泄露
		llm_configs: db
			.prepare("SELECT id, name, provider, base_url, model, is_active, created_at FROM llm_configs")
			.all() as ExportData["llm_configs"],
		prompt_tags: db.prepare("SELECT id, name, created_at FROM prompt_tags").all() as any[],
		prompt_tag_map: db.prepare("SELECT prompt_id, tag_id FROM prompt_tag_map").all() as any[],
	};
	return JSON.stringify(data, null, 2);
}

type ImportablePrompt = Partial<Prompt> & Pick<Prompt, "id" | "scenario_id" | "title" | "content">;

export function importData(json: string): void {
	let data: ExportData;
	try {
		data = JSON.parse(json) as ExportData;
	} catch (err) {
		throw new Error("备份文件不是有效的 JSON：" + (err instanceof Error ? err.message : String(err)));
	}
	if (!data || !Array.isArray(data.scenarios) || !Array.isArray(data.prompts)) {
		throw new Error("备份文件格式不正确：缺少 scenarios 或 prompts 数据");
	}
	db.transaction(() => {
		// 不要在此事务内切换 PRAGMA foreign_keys（SQLite 中事务内是 no-op）。
		// 下面的插入顺序已按依赖排列（先父表后子表），外键开启状态下即可安全导入；
		// 引用不存在父记录的行会被外键拒绝并整体回滚。
		db.prepare("DELETE FROM precheck_runs").run();
		db.prepare("DELETE FROM prompt_versions").run();
		db.prepare("DELETE FROM prompts").run();
		db.prepare("DELETE FROM scenario_tags").run();
		db.prepare("DELETE FROM scenarios").run();
		db.prepare("DELETE FROM tags").run();
		db.prepare("DELETE FROM llm_configs").run();
		db.prepare("DELETE FROM prompt_tag_map").run();
		db.prepare("DELETE FROM prompt_tags").run();

		// Reset auto-increment counters
		db.exec("DELETE FROM sqlite_sequence");

		for (const s of data.scenarios) {
			db.prepare("INSERT INTO scenarios (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(s.id, s.name, s.description, s.created_at, s.updated_at);
		}
		for (const t of data.tags ?? []) {
			db.prepare("INSERT INTO tags (id, name, created_at) VALUES (?, ?, ?)").run(t.id, t.name, t.created_at);
		}
		for (const st of data.scenario_tags ?? []) {
			db.prepare("INSERT INTO scenario_tags (scenario_id, tag_id) VALUES (?, ?)").run(st.scenario_id, st.tag_id);
		}
		for (const c of data.llm_configs ?? []) {
			db.prepare("INSERT INTO llm_configs (id, name, provider, api_key, base_url, model, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(c.id, c.name, c.provider, c.api_key ?? "", c.base_url, c.model, c.is_active, c.created_at);
		}
		for (const p of data.prompts as ImportablePrompt[]) {
			// v2 columns are optional so v1 backups still import
			db.prepare(
				`INSERT INTO prompts (id, scenario_id, title, content, source, model_name, is_favorite, use_count, last_used_at, deleted_at, created_at, updated_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			).run(
				p.id,
				p.scenario_id,
				p.title,
				p.content,
				p.source ?? "manual",
				p.model_name ?? null,
				p.is_favorite ?? 0,
				p.use_count ?? 0,
				p.last_used_at ?? null,
				p.deleted_at ?? null,
				p.created_at ?? "",
				p.updated_at ?? "",
			);
		}
		for (const v of data.prompt_versions ?? []) {
			db.prepare("INSERT INTO prompt_versions (id, prompt_id, version_number, content, note, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(v.id, v.prompt_id, v.version_number, v.content, v.note, v.created_at);
		}
		for (const r of data.precheck_runs ?? []) {
			db.prepare("INSERT INTO precheck_runs (id, prompt_id, type, input_text, output_text, model_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(r.id, r.prompt_id, r.type, r.input_text, r.output_text, r.model_name, r.created_at);
		}
		// v2.1 additions: prompt-level tags (optional so older backups still import)
		for (const t of data.prompt_tags ?? []) {
			db.prepare("INSERT INTO prompt_tags (id, name, created_at) VALUES (?, ?, ?)").run(t.id, t.name, t.created_at);
		}
		for (const m of data.prompt_tag_map ?? []) {
			db.prepare("INSERT INTO prompt_tag_map (prompt_id, tag_id) VALUES (?, ?)").run(m.prompt_id, m.tag_id);
		}
	})();
}
