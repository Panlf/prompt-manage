<div align="center">

# PromptHub

**一款本地优先、简洁高效的提示词管理桌面应用**

管理你的 AI 提示词：场景分类 · 模板变量 · 一键复制 · 全局搜索 · 版本历史 · AI 生成与预检

[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue)]()
[![Framework](https://img.shields.io/badge/Electrobun-1.18-ffb224)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6)]()
[![SQLite](https://img.shields.io/badge/SQLite-WAL-003b57)]()
[![Tests](https://img.shields.io/badge/tests-36%2F36%20passing-34c759)]()
[![License: MIT](https://img.shields.io/badge/License-MIT-orange.svg)](./LICENSE)

[功能特性](#-功能特性) · [快速开始](#-快速开始) · [构建打包](#-构建与打包) · [架构](#-架构)

</div>

---

## 📖 简介

PromptHub 帮你把散落各处的 AI 提示词变成一座可检索、可复用、可追溯的本地知识库。数据 100% 存储在本机 SQLite 中，除你自己配置的大模型 API 外**不发起任何网络请求**。

围绕「**存 → 找 → 填 → 复制 → 统计**」的完整使用闭环设计：

```
┌──────────────────────────────────────────────────────────────┐
│   存            找            填            复制         统计   │
│ 场景/标签  →  Ctrl+K 搜索  →  {{变量}}填充  →  一键复制  →  使用计数 │
│  AI 生成      收藏置顶        实时预览      回收站兜底    最近使用  │
└──────────────────────────────────────────────────────────────┘
```

## ✨ 功能特性

### 核心能力
- 🗂️ **场景 + 标签管理** — 按使用场景组织提示词，标签可增删改、点击筛选
- 🏷️ **提示词标签** — 同一场景下按方向区分提示词（正式 / 口语化 / 平台风格…），支持按标签过滤与搜索
- 🔤 **模板变量系统** — 自动识别内容中的 `{{变量名}}`（支持中文），逐项填写、实时预览、一键复制填充结果
- 📋 **一键复制** — 任意列表、详情页、搜索结果均可秒复制，复制即记一次使用
- ⭐ **收藏** — 星标收藏常用提示词，收藏视图按最近使用排序
- 🔍 **全局搜索（Ctrl/Cmd+K）** — 命令面板，跨场景/标题/内容/标签实时搜索，关键词高亮，全键盘操作
- 📊 **使用统计** — 使用次数、最近使用时间；「全部提示词」支持最近使用 / 最常用 / 最近更新排序（局部刷新无闪烁）
- 🗑️ **回收站** — 提示词软删除，可恢复、可彻底删除、可清空
- 🏠 **总览仪表盘** — 场景/提示词/收藏/累计使用四项统计 + 最近使用 + 收藏速览

### AI 能力（自带模型配置，无内置账号）
- 🤖 **AI 生成提示词** — 描述需求，由大模型生成提示词初稿
- 🧪 **预检** — 用当前提示词直接试跑：生成文本 / 生成图片 / 优化文本，运行记录留存
- 🔌 **多模型管理** — DeepSeek / MiMo / Ollama / 任意 OpenAI 兼容接口，多配置切换、连通性测试

### 工程与数据
- 🕰️ **版本历史** — 编辑自动快照，可查看、可恢复
- 💾 **导入导出** — JSON 全量备份/恢复，向后兼容 v1 格式（API 密钥不出现在备份文件中）
- 📁 **数据目录迁移** — 自定义存储位置，自动迁移
- 🌗 **深浅色模式** — 跟随系统自动切换
- ⌨️ **快捷键** — `Ctrl/Cmd+K` 搜索、`Ctrl/Cmd+S` 保存、`Esc` 关闭弹层

## 📸 截图

> 📝 截图待补充：建议放入 `docs/screenshots/`，替换下方占位

| 总览仪表盘 | 全局搜索 | 变量填充 |
|:---:|:---:|:---:|
| 待补充 | 待补充 | 待补充 |

## 🚀 快速开始

### 环境要求

- [Bun](https://bun.sh) ≥ 1.1（构建与测试工具链）
- Windows / macOS / Linux（Windows 打包已验证）

### 安装与运行

```bash
# 1. 克隆仓库
git clone https://github.com/<your-name>/prompt-manage.git
cd prompt-manage

# 2. 安装依赖
bun install

# 3. 开发模式运行
bun run dev

# 4. 类型检查 + 单元测试
bun run typecheck
bun test
```

## 📦 构建与打包

**Windows 一键打包**（推荐，双击或命令行运行）：

```bat
scripts\package-win10.bat                :: 完整流程：依赖检查 + 类型检查 + 测试 + 构建 + 绿色版打包
scripts\package-win10.bat --skip-tests   :: 跳过测试，直接打包
scripts\package-win10.bat --no-open      :: 结束后不自动打开产物文件夹
```

产物：`build\PromptHub\`（绿色版，运行 `bin\PromptHub.exe`）、`build\PromptHub.zip`、`build\stable-win-x64\prompt-manage-Setup.zip`。

### 自定义数据存储位置（可选）

默认数据存于 `%LOCALAPPDATA%\promptmanage.app\stable\`。想把数据放到任意位置（如 D 盘）：

1. 把绿色版里的 `bin\config.example.json` 复制为同目录 **`config.json`**
2. 编辑内容：`{ "dataDir": "D:\\PromptHubData" }`
3. 重启应用即可；也可随时在应用内「数据管理 → 迁移到新位置」搬移已有数据（自动写回生效中的配置文件）

**升级替换程序时数据永不丢失**：数据与程序完全分离。升级用「覆盖解压」——zip 中不含 `config.json`，解压不会删除你的配置；数据目录在程序文件夹之外，同样不受影响。

## 📝 更新日志

### v2.1.3
- 新增：业务弹窗防误触（去遮罩关闭 + Esc + 草稿自动保留/恢复）
- 新增：导出数据可选目标文件夹并明确提示位置；导出文件改名 `PromptHub-export-*.json`
- 新增：数据存储位置「检查路径」按钮（校验存在/可写，可自动创建）
- 优化：「最近使用」排序将未使用过的提示词置底；列表明确显示「未使用」状态
- 优化：复制计数防抖（1.2 秒内重复复制同一提示词只记一次使用）
- 优化：去除侧边栏与应用标题栏的重复标题；修复数据存储卡片的圆角内容溢出
- 优化：打包产物统一命名 PromptHub（`PromptHub/` 目录 + `PromptHub.zip`）
- 修复：应用图标统一为蓝色系（exe/任务栏一致，任务栏不再显示 bun 默认图标）

### v2.1.2
- 新增：外置 `config.json` 自定义数据目录（详见上方「自定义数据存储位置」）

### v2.1
- 新增：提示词级标签（同场景按方向区分）、总览仪表盘、全局搜索、回收站、收藏、模板变量、使用统计
- 优化：导航淡入淡出过渡、全部提示词页排序/过滤局部刷新（无整页闪烁）

### v2.0
- 首个大版本：场景管理、AI 生成、预检、多模型配置、版本历史、数据迁移

**手动命令**：

```bash
bun run build        # 当前平台构建（stable 环境）
bun run build:win    # Windows：构建 + 解包绿色版 + 嵌入图标 + 打 zip
bun run build:mac    # macOS
bun run build:linux  # Linux
bun run build:all    # 全平台
```

## ⌨️ 快捷键

| 快捷键 | 作用 |
|--------|------|
| `Ctrl / Cmd + K` | 打开/关闭全局搜索命令面板 |
| `Ctrl / Cmd + S` | 保存提示词编辑（提示词详情页） |
| `↑ ↓` `Enter` `Esc` | 命令面板内选择 / 打开 / 关闭 |

## 🏗️ 架构

基于 [Electrobun](https://electrobun.dev/)：Bun 后端进程 + 系统 WebView 前端，RPC 类型安全通信，零前端框架。

```
src/
├── bun/                  # 后端进程
│   ├── index.ts          #   窗口 + RPC handlers
│   ├── db.ts             #   SQLite 数据层（schema、软删除、搜索、统计、迁移）
│   └── llm.ts            #   OpenAI 兼容 API（对话/图片/测试连接）
├── mainview/             # 前端（WebView，原生 DOM）
│   ├── core.ts           #   RPC 客户端 / 状态 / 确认弹窗 / 剪贴板
│   ├── components.ts     #   共享组件（星标、复制芯片、提示词行）
│   ├── dashboard.ts      #   总览仪表盘
│   ├── scenarios.ts      #   场景管理
│   ├── prompts.ts        #   提示词：编辑 + 变量填充 + 预检 + 版本
│   ├── allprompts.ts     #   全部提示词 / 收藏视图
│   ├── trash.ts          #   回收站
│   ├── command.ts        #   全局搜索命令面板
│   └── settings.ts       #   模型设置 / 数据管理
├── shared/types.ts       # 前后端共享类型 + {{变量}} 引擎
└── tests/                # bun test 单元测试（36 用例）
```

**数据模型**：`scenarios` / `tags` / `prompts` / `prompt_versions` / `precheck_runs` / `llm_configs` 六张表；v2 新增收藏、使用统计、软删除列，老库启动时自动迁移，数据无损。

## 🧪 测试

```bash
bun run typecheck   # TypeScript strict 全量类型检查
bun test            # 36 个单元测试：变量引擎 + 数据层（含 v1 备份兼容导入）
```

测试细节见 [docs/TESTING.md](docs/TESTING.md)。

## 🤝 贡献

欢迎 Issue 与 PR。提交前请确保：

```bash
bun run typecheck && bun test   # 均通过
```

## ⚖️ 许可证

本项目基于 [MIT License](./LICENSE) 开源，你可以自由地使用、修改和分发，只需保留原始版权声明。

> 💡 如果你在本项目的基础上构建了自己的产品，欢迎回来提 Issue 告诉我们！

---

<div align="center">

如果这个项目对你有帮助，欢迎点一个 ⭐ Star

</div>
