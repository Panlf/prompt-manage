import { BrowserView, BrowserWindow, type RPCSchema } from "electrobun/bun";
import type { Scenario, Tag, Prompt, PromptVersion, PrecheckRun, LLMConfig, PromptWithScenario, SearchResults, DashboardStats, PromptSort } from "../shared/types";
import * as db from "./db";
import * as llm from "./llm";

let mainWindow: any = null;

// 还原最大化时的窗口边界兜底（无边框+透明窗口在 Windows 上 unmaximize 不一定生效）
let savedWinBounds: { x: number; y: number; width: number; height: number } | null = null;

// Windows 上无边框+透明（分层）窗口 resize 后，输入命中区域可能停留在旧尺寸
// （渲染正常，但旧区域之外鼠标点击会穿透到下层窗口）。重设一次窗口边界可强制
// 原生层重算；注意同值重设会被跳过，必须先 ±1px 抖动产生真实 resize。
function syncWindowInputRegion() {
	if (!mainWindow) return;
	const frame = mainWindow.getFrame();
	mainWindow.setFrame(frame.x, frame.y, frame.width + 1, frame.height + 1);
	mainWindow.setFrame(frame.x, frame.y, frame.width, frame.height);
}

type AppRPC = {
	bun: RPCSchema<{
		requests: {
			// Scenarios
			getScenarios: { params: { tag?: string }; response: Scenario[] };
			getScenario: { params: { id: number }; response: Scenario };
			createScenario: { params: { name: string; description: string; tags: string[] }; response: Scenario };
			updateScenario: { params: { id: number; name: string; description: string; tags: string[] }; response: Scenario };
			deleteScenario: { params: { id: number }; response: { success: boolean } };

			// Tags
			getAllTags: { params: {}; response: Tag[] };
			renameTag: { params: { id: number; name: string }; response: Tag };
			deleteTag: { params: { id: number }; response: { success: boolean } };

			// Prompts
			getPrompts: { params: { scenario_id: number }; response: Prompt[] };
			getPrompt: { params: { id: number }; response: Prompt };
			createPrompt: { params: { scenario_id: number; title: string; content: string; source: string; model_name?: string; tags?: string[] }; response: Prompt };
			updatePrompt: { params: { id: number; title: string; content: string; tags?: string[] }; response: Prompt };
			trashPrompt: { params: { id: number }; response: { success: boolean } };
			restorePrompt: { params: { id: number }; response: Prompt };
			purgePrompt: { params: { id: number }; response: { success: boolean } };
			emptyTrash: { params: {}; response: { purged: number } };
			getTrashedPrompts: { params: {}; response: PromptWithScenario[] };

			// Prompt tags
			getAllPromptTags: { params: {}; response: Tag[] };

			// Favorites & usage
			togglePromptFavorite: { params: { id: number }; response: Prompt };
			recordPromptUse: { params: { id: number }; response: { success: boolean } };
			getFavoritePrompts: { params: {}; response: PromptWithScenario[] };
			getAllPrompts: { params: { sort: string; favorite?: boolean; source?: string; tag?: string }; response: PromptWithScenario[] };
			getRecentPrompts: { params: { limit: number }; response: PromptWithScenario[] };

			// Dashboard & search
			getDashboardStats: { params: {}; response: DashboardStats };
			searchAll: { params: { query: string }; response: SearchResults };

			// Prompt versions
			getPromptVersions: { params: { prompt_id: number }; response: PromptVersion[] };
			savePromptVersion: { params: { prompt_id: number; content: string; note: string }; response: PromptVersion };

			// Precheck
			getPrecheckRuns: { params: { prompt_id: number }; response: PrecheckRun[] };
			runPrecheck: { params: { prompt_id: number; type: string; input_text: string; llm_config_id: number }; response: PrecheckRun };

			// AI prompt generation
			generatePromptAI: { params: { scenario_name: string; description: string; llm_config_id: number }; response: { content: string } };

			// LLM configs
			getLLMConfigs: { params: {}; response: LLMConfig[] };
			createLLMConfig: { params: { name: string; provider: string; api_key: string; base_url: string; model: string }; response: LLMConfig };
			updateLLMConfig: { params: { id: number; name: string; provider: string; api_key: string; base_url: string; model: string }; response: LLMConfig };
			deleteLLMConfig: { params: { id: number }; response: { success: boolean } };
			setActiveLLMConfig: { params: { id: number }; response: { success: boolean } };
			testLLMConfig: { params: { id: number }; response: { success: boolean; message: string } };

			// Data
			exportData: { params: {}; response: { data: string } };
			importData: { params: { data: string }; response: { success: boolean; message: string } };
			getDataPath: { params: {}; response: { current: string; default: string; custom: string | null; dbPath: string; configSource: string; portableConfigPath: string } };
			migrateData: { params: { newPath: string }; response: { success: boolean; newPath: string; message: string } };
			validateDataDir: { params: { path: string }; response: { ok: boolean; message: string } };

			// Window controls
			windowMinimize: { params: {}; response: void };
			windowSetMaximized: { params: { maximized: boolean }; response: void };
			windowSyncInputRegion: { params: {}; response: void };
			windowClose: { params: {}; response: void };
			windowGetPosition: { params: {}; response: { x: number; y: number } };
			windowSetPosition: { params: { x: number; y: number }; response: void };

			// UI prefs（界面偏好，如主题色）
			getUiPref: { params: { key: string }; response: string | null };
			setUiPref: { params: { key: string; value: string }; response: void };
		};
		messages: {};
	}>;
	webview: RPCSchema<{
		requests: {};
		messages: {};
	}>;
};

const appRPC = BrowserView.defineRPC<AppRPC>({
	maxRequestTime: 120000,
	handlers: {
		requests: {
			// ---- Scenarios ----
			getScenarios: ({ tag }) => {
				return db.getScenarios(tag);
			},
			getScenario: ({ id }) => {
				const s = db.getScenario(id);
				if (!s) throw new Error("Scenario not found");
				return s;
			},
			createScenario: ({ name, description, tags }) => {
				return db.createScenario(name, description, tags);
			},
			updateScenario: ({ id, name, description, tags }) => {
				return db.updateScenario(id, name, description, tags);
			},
			deleteScenario: ({ id }) => {
				db.deleteScenario(id);
				return { success: true };
			},

			// ---- Tags ----
			getAllTags: () => {
				return db.getAllTags();
			},
			renameTag: ({ id, name }) => {
				return db.renameTag(id, name);
			},
			deleteTag: ({ id }) => {
				db.deleteTag(id);
				return { success: true };
			},

			// ---- Prompts ----
			getPrompts: ({ scenario_id }) => {
				return db.getPrompts(scenario_id);
			},
			getPrompt: ({ id }) => {
				const p = db.getPrompt(id);
				if (!p) throw new Error("Prompt not found");
				return p;
			},
			createPrompt: ({ scenario_id, title, content, source, model_name, tags }) => {
				return db.createPrompt(scenario_id, title, content, source, model_name ?? null, tags);
			},
			updatePrompt: ({ id, title, content, tags }) => {
				return db.updatePrompt(id, title, content, tags);
			},
			trashPrompt: ({ id }) => {
				db.trashPrompt(id);
				return { success: true };
			},
			restorePrompt: ({ id }) => {
				return db.restorePrompt(id);
			},
			purgePrompt: ({ id }) => {
				db.purgePrompt(id);
				return { success: true };
			},
			emptyTrash: () => {
				return { purged: db.emptyTrash() };
			},
			getTrashedPrompts: () => {
				return db.getTrashedPrompts();
			},

			// ---- Prompt tags ----
			getAllPromptTags: () => {
				return db.getAllPromptTags();
			},

			// ---- Favorites & usage ----
			togglePromptFavorite: ({ id }) => {
				return db.togglePromptFavorite(id);
			},
			recordPromptUse: ({ id }) => {
				db.recordPromptUse(id);
				return { success: true };
			},
			getFavoritePrompts: () => {
				return db.getFavoritePrompts();
			},
			getAllPrompts: ({ sort, favorite, source, tag }) => {
				return db.getAllPrompts(sort as PromptSort, { favorite, source, tag });
			},
			getRecentPrompts: ({ limit }) => {
				return db.getRecentPrompts(limit);
			},

			// ---- Dashboard & search ----
			getDashboardStats: () => {
				return db.getDashboardStats();
			},
			searchAll: ({ query }) => {
				return db.searchAll(query);
			},

			// ---- Prompt versions ----
			getPromptVersions: ({ prompt_id }) => {
				return db.getPromptVersions(prompt_id);
			},
			savePromptVersion: ({ prompt_id, content, note }) => {
				return db.savePromptVersion(prompt_id, content, note);
			},

			// ---- Precheck ----
			getPrecheckRuns: ({ prompt_id }) => {
				return db.getPrecheckRuns(prompt_id);
			},
			runPrecheck: async ({ prompt_id, type, input_text, llm_config_id }) => {
				const prompt = db.getPrompt(prompt_id);
				if (!prompt) throw new Error("Prompt not found");
				const config = db.getLLMConfig(llm_config_id);
				if (!config) throw new Error("LLM config not found");

				let output = "";
				try {
					if (type === "text") {
						output = await llm.generateText(config, prompt.content);
					} else if (type === "image") {
						output = await llm.generateImage(config, prompt.content);
					} else if (type === "optimize") {
						output = await llm.optimizeText(config, prompt.content, input_text);
					} else {
						throw new Error(`Unknown precheck type: ${type}`);
					}
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					output = `[Error] ${msg}`;
				}

				return db.savePrecheckRun(prompt_id, type, input_text, output, config.name);
			},

			// ---- AI prompt generation ----
			generatePromptAI: async ({ scenario_name, description, llm_config_id }) => {
				const config = db.getLLMConfig(llm_config_id);
				if (!config) throw new Error("LLM config not found");
				const content = await llm.generatePromptAI(config, scenario_name, description);
				return { content };
			},

			// ---- LLM configs ----
			getLLMConfigs: () => {
				return db.getLLMConfigs();
			},
			createLLMConfig: ({ name, provider, api_key, base_url, model }) => {
				return db.createLLMConfig(name, provider, api_key, base_url, model);
			},
			updateLLMConfig: ({ id, name, provider, api_key, base_url, model }) => {
				return db.updateLLMConfig(id, name, provider, api_key, base_url, model);
			},
			deleteLLMConfig: ({ id }) => {
				db.deleteLLMConfig(id);
				return { success: true };
			},
			setActiveLLMConfig: ({ id }) => {
				db.setActiveLLMConfig(id);
				return { success: true };
			},
			testLLMConfig: async ({ id }) => {
				const config = db.getLLMConfig(id);
				if (!config) return { success: false, message: "Config not found" };
				try {
					const reply = await llm.testConnection(config);
					return { success: true, message: reply };
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					return { success: false, message: msg };
				}
			},

			// ---- Data ----
			exportData: () => {
				return { data: db.exportData() };
			},
			importData: ({ data }) => {
				try {
					db.importData(data);
					return { success: true, message: "导入成功" };
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					return { success: false, message: msg };
				}
			},

			// ---- Data Storage Path ----
			getDataPath: () => {
				return {
					current: db.getDataDir(),
					default: db.getDefaultDataDir(),
					custom: db.getCustomDataDir(),
					dbPath: db.getDbPath(),
					configSource: db.getConfigSource(),
					portableConfigPath: db.getPortableConfigPath(),
				};
			},
			migrateData: ({ newPath }) => {
				try {
					const newDbPath = db.migrateDataDir(newPath);
					return { success: true, newPath: newDbPath, message: "数据已迁移，请重启应用以加载新位置的数据" };
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					return { success: false, newPath: "", message: msg };
				}
			},

			validateDataDir: ({ path }) => {
				return db.validateDataDir(path);
			},

			// ---- Window Controls ----
			windowMinimize: () => {
				if (mainWindow) mainWindow.minimize();
			},
			// 是否最大化由前端按视口尺寸推断后传入（原生 isMaximized() 在无边框
			// 透明窗口上不可靠，系统贴靠/Win+方向键触发的最大化后端也感知不到）
			windowSetMaximized: ({ maximized }) => {
				if (!mainWindow) return;
				if (maximized) {
					const pos = mainWindow.getPosition();
					const size = mainWindow.getSize();
					savedWinBounds = { x: pos.x, y: pos.y, width: size.width, height: size.height };
					mainWindow.maximize();
					syncWindowInputRegion();
				} else {
					mainWindow.unmaximize();
					const bounds = savedWinBounds ?? { x: 0, y: 0, width: 1200, height: 800 };
					mainWindow.setFrame(bounds.x, bounds.y, bounds.width, bounds.height);
					savedWinBounds = null;
				}
			},
			windowSyncInputRegion: () => {
				syncWindowInputRegion();
			},
			windowClose: () => {
				if (mainWindow) mainWindow.close();
			},
			windowGetPosition: () => {
				if (mainWindow) return mainWindow.getPosition();
				return { x: 0, y: 0 };
			},
			windowSetPosition: ({ x, y }) => {
				if (mainWindow) mainWindow.setPosition(x, y);
			},

			// ---- UI prefs ----
			getUiPref: ({ key }) => {
				return db.getPref(key);
			},
			setUiPref: ({ key, value }) => {
				db.setPref(key, value);
			},
		},
		messages: {},
	},
});

mainWindow = new BrowserWindow({
	title: "提示词管理",
	url: "views://mainview/index.html",
	rpc: appRPC,
	frame: {
		x: 0,
		y: 0,
		width: 1200,
		height: 800,
	},
	titleBarStyle: "hidden",
	// 注意：transparent: true（分层窗口）在 Windows 上最大化后输入命中区域不会跟随
	// 窗口新尺寸，旧区域之外鼠标点击会穿透到下层窗口（界面自身绘制不透明背景，
	// 透明度无可见收益），故必须保持 false
	transparent: false,
	passthrough: false,
	renderer: "native",
	preload: null,
	viewsRoot: null,
	html: null,
	navigationRules: null,
	sandbox: false,
});

console.log("Prompt Manager started!");
console.log(`Database: ${db.getDbPath()}`);
