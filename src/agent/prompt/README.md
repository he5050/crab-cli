# Prompt Module — 系统提示词构建引擎

## 整体定位

Prompt 模块是系统的提示词构建引擎，负责根据对话模式、运行时环境和模型特性，动态组装完整的系统提示词。它与对话循环（`@conversation/llmLoop`）联动，在每次新对话启动或模式切换时生成适配的提示词。

## 核心功能

1. **模式管理** — 支持 6 种对话模式（chat/plan/team/yolo/simple/security），每种模式有独立的指令模板和权限约束
2. **提示词构建** — 根据模型类型选择基础提示词，叠加模式指令、环境上下文、工具说明等模块
3. **环境注入** — 自动检测操作系统、Shell 类型、平台命令，注入到提示词中
4. **指令文件加载** — 从项目根目录向上查找 AGENTS.md/CLAUDE.md，注入项目特定指令
5. **动态 Reminder** — 根据会话状态生成动态系统提醒
6. **Registry 模式** — 支持通过注册表方式组装提示词段落，便于扩展

## 目录结构

```
src/prompt/
├── index.ts              # 统一出入口，所有外部引用通过此文件
├── types.ts              # 类型导出入口
├── README.md             # 本文档
│
├── types/                # 模式类型定义
│   └── index.ts          # ChatMode, ModeMeta, MODE_META, 模式判断工具
│
├── modes/                # 模式指令模板
│   ├── index.ts          # 统一导出
│   ├── chat.ts           # 对话模式指令
│   ├── plan.ts           # 计划模式指令
│   ├── team.ts           # 团队模式指令
│   ├── yolo.ts           # YOLO 模式指令
│   ├── simple.ts         # 简单模式指令
│   └── security.ts       # 安全模式指令
│
├── sections/             # 提示词段落组件
│   ├── index.ts          # 统一导出
│   ├── baseBehavior.ts   # 基础行为准则
│   ├── toolPolicy.ts     # 工具使用策略
│   ├── outputStyle.ts    # 输出风格
│   └── agentContract.ts  # Agent 职责契约
│
├── builder.ts            # 系统提示词构建器
├── context.ts            # 环境上下文注入
├── registry.ts           # Registry 模式提示词生成
└── toolUsageSection.ts   # 工具使用说明段落
```

## 子模块说明

| 子模块                | 职责                  | 主要导出                                                                                                                                                                           |
| --------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `types/`              | 模式类型定义 + 元信息 | `ChatMode`, `ModeMeta`, `MODE_META`, `getModeMeta()`, `isReadOnlyMode()`, `isAutoApproveMode()`, `isToollessMode()`                                                                |
| `modes/`              | 6 种模式的指令模板    | `CHAT_MODE_INSTRUCTION`, `PLAN_MODE_INSTRUCTION`, `TEAM_MODE_INSTRUCTION`, `YOLO_MODE_INSTRUCTION`, `SIMPLE_MODE_INSTRUCTION`, `SECURITY_MODE_INSTRUCTION`, `getModeInstruction()` |
| `sections/`           | 可复用的提示词段落    | `buildBaseBehaviorSection()`, `buildToolPolicySection()`, `buildOutputStyleSection()`, `buildAgentContractSection()`                                                               |
| `builder.ts`          | 提示词构建器          | `buildSystemPrompt()`, `buildSystemPromptAsync()`, `previewSystemPrompt()`, `selectBasePromptByModel()`, `buildDynamicReminder()`                                                  |
| `context.ts`          | 环境上下文            | `buildEnvironmentContext()`, `loadInstructionFiles()`, `buildInstructionSection()`, `getShellName()`, `getPlatformCommandsSection()`                                               |
| `registry.ts`         | Registry 模式         | `buildPromptFromRegistry()`, `listPromptSectionNames()`                                                                                                                            |
| `toolUsageSection.ts` | 工具使用说明          | `TOOL_USAGE_SECTION`                                                                                                                                                               |

## 完整 API 导出

### 类型导出

```typescript
import type {
  // 模式类型
  ChatMode, // "chat" | "plan" | "team" | "yolo" | "simple" | "security"
  ModeMeta, // 模式元信息接口

  // 构建器
  PromptBuilderOptions, // 构建选项
  DynamicReminderOptions, // 动态提醒选项

  // Registry
  PromptRegistryOptions, // Registry 选项
  AgentPromptContract, // Agent 职责契约类型

  // 环境上下文
  EnvironmentContextOptions, // 环境上下文选项
  InstructionFile, // 指令文件接口
} from "@prompt";
```

### 值导出

```typescript
import {
  // ─── 模式元信息 ──────────────────────────────────────────
  MODE_META, // 所有模式的元信息常量
  getModeMeta, // 获取指定模式的元信息
  listModes, // 列出所有模式
  isModeReadOnly, // 判断是否为只读模式
  isModeAutoApprove, // 判断是否自动批准模式

  // ─── 模式指令 ────────────────────────────────────────────
  getModeInstruction, // 获取模式指令文本
  CHAT_MODE_INSTRUCTION, // 对话模式指令
  PLAN_MODE_INSTRUCTION, // 计划模式指令
  TEAM_MODE_INSTRUCTION, // 团队模式指令
  YOLO_MODE_INSTRUCTION, // YOLO 模式指令
  SIMPLE_MODE_INSTRUCTION, // 简单模式指令
  SECURITY_MODE_INSTRUCTION, // 安全模式指令

  // ─── 提示词构建 ──────────────────────────────────────────
  buildSystemPrompt, // 同步构建系统提示词
  buildSystemPromptAsync, // 异步构建系统提示词
  previewSystemPrompt, // 预览系统提示词
  selectBasePromptByModel, // 根据模型选择基础提示词
  buildDynamicReminder, // 构建动态提醒
  isReadOnlyMode, // 判断只读模式（builder 内部版本）
  isAutoApproveMode, // 判断自动批准模式（builder 内部版本）

  // ─── Registry ────────────────────────────────────────────
  buildPromptFromRegistry, // 通过注册表构建提示词
  listPromptSectionNames, // 列出所有段落名称

  // ─── 环境上下文 ──────────────────────────────────────────
  buildEnvironmentContext, // 构建环境上下文
  getShellName, // 获取 Shell 名称
  getPlatformCommandsSection, // 获取平台命令段落
  loadInstructionFiles, // 异步加载指令文件
  loadInstructionFilesSync, // 同步加载指令文件
  buildInstructionSection, // 构建指令段落
  clearInstructionCache, // 清除指令缓存

  // ─── Sections ────────────────────────────────────────────
  buildBaseBehaviorSection, // 构建基础行为准则
  buildToolPolicySection, // 构建工具使用策略
  buildOutputStyleSection, // 构建输出风格
  buildAgentContractSection, // 构建 Agent 职责契约
} from "@prompt";
```

## 使用方法

### 构建系统提示词

```typescript
import { buildSystemPrompt, buildSystemPromptAsync } from "@prompt";

// 同步构建
const prompt = buildSystemPrompt({
  mode: "chat",
  model: "claude-sonnet-4-20250514",
  cwd: process.cwd(),
  enableYolo: false,
});

// 异步构建（支持远程指令文件）
const asyncPrompt = await buildSystemPromptAsync({
  mode: "plan",
  model: "gpt-4.1-2025-04-14",
  cwd: process.cwd(),
  enableYolo: false,
  loadRemoteInstructions: true,
});
```

### 模式切换

```typescript
import { getModeMeta, listModes, isModeReadOnly } from "@prompt";

// 获取模式元信息（用于 UI 显示）
const meta = getModeMeta("plan");
// → { mode: "plan", icon: "📋", label: "Plan", description: "..." }

// 列出所有模式
const allModes = listModes();

// 判断是否为只读模式
if (isModeReadOnly("security")) {
  // 禁用工具调用
}
```

### 环境上下文注入

```typescript
import { buildEnvironmentContext, loadInstructionFilesSync } from "@prompt";

// 构建环境上下文
const context = buildEnvironmentContext({
  cwd: process.cwd(),
  os: process.platform,
  shell: "zsh",
});

// 加载项目指令文件
const instructions = loadInstructionFilesSync({
  cwd: process.cwd(),
  maxDepth: 5,
});
```

### Registry 模式

```typescript
import { buildPromptFromRegistry, listPromptSectionNames } from "@prompt";

// 列出所有可用段落
const sections = listPromptSectionNames();
// → ["baseBehavior", "toolPolicy", "outputStyle", "agentContract", ...]

// 自定义组装提示词
const prompt = buildPromptFromRegistry({
  sections: ["baseBehavior", "toolPolicy", "customSection"],
  mode: "chat",
  model: "claude-sonnet-4-20250514",
  context: { cwd: process.cwd() },
});
```

### 预览提示词

```typescript
import { previewSystemPrompt } from "@prompt";

// 预览构建后的提示词（用于调试）
const preview = previewSystemPrompt({
  mode: "team",
  model: "claude-opus-4-20250514",
  cwd: process.cwd(),
});
console.log(preview);
```

## 6 种对话模式

| 模式       | 图标 | 只读 | 自动批准 | 无工具 | 说明                                            |
| ---------- | ---- | ---- | -------- | ------ | ----------------------------------------------- |
| `chat`     | 💬   | ❌   | ❌       | ❌     | 默认对话模式，直接与 AI 交互                    |
| `plan`     | 📋   | ✅   | ❌       | ❌     | 计划模式：AI 先分析需求并制定计划，确认后再执行 |
| `team`     | 👥   | ❌   | ❌       | ❌     | 团队模式：AI 协调多个子代理并行工作             |
| `yolo`     | 🔒   | ❌   | ✅       | ❌     | YOLO 模式：自动执行所有操作，跳过确认           |
| `simple`   | 📝   | ❌   | ❌       | ✅     | 简单模式：纯文本对话，不使用工具                |
| `security` | 🛡️   | ✅   | ❌       | ❌     | 安全审计模式：专注于漏洞检测和安全分析          |

## 提示词组装顺序

```
1. 基础提示词（根据模型选择：Claude/GPT/Gemini）
   ↓
2. 模式指令（根据当前模式注入）
   ↓
3. YOLO 叠加标识（如果启用 YOLO 模式）
   ↓
4. 平台命令段落（根据操作系统注入）
   ↓
5. 工具使用说明
   ↓
6. 环境上下文（Shell、OS、路径等）
   ↓
7. Token 预算约束（可选）
   ↓
8. 指令文件内容（AGENTS.md/CLAUDE.md）
   ↓
9. 动态 reminder
   ↓
10. 自定义追加内容
```

## 与外部系统的交互

| 外部模块                | 交互方式                   | 说明                       |
| ----------------------- | -------------------------- | -------------------------- |
| `@conversation/llmLoop` | 调用 `buildSystemPrompt()` | 在对话启动时生成系统提示词 |
| `@agent/core`           | 读取模式元信息             | 切换模式时更新 UI 和权限   |
| `@schema/config`        | 读取提示词配置             | 注入模型、Token 预算等配置 |
| `@core/logger`          | 日志记录                   | 提示词构建过程的日志输出   |
| `@ai-sdk`               | 调用 LLM                   | 动态 reminder 生成时使用   |

## 边界与限制

1. **仅构建文本** — 不负责 TUI 渲染或 LLM 调用，仅生成提示词字符串
2. **指令文件向上查找** — 从 cwd 开始向上查找至项目根目录，最多 5 层
3. **模型感知有限** — 目前仅区分 Claude/GPT/Gemini 三大系列
4. **缓存机制** — 指令文件内容会缓存，需调用 `clearInstructionCache()` 刷新
5. **Registry 扩展性** — 自定义段落需预先注册到 `sections/` 目录
6. **YOLO 叠加** — YOLO 模式是在基础模式（chat/plan/team）上的叠加，不是独立模式

## 设计决策

| 决策                        | 原因                                                       |
| --------------------------- | ---------------------------------------------------------- |
| 模式指令外置为独立文件      | 便于维护和多 Agent 复用，避免 builder.ts 过于臃肿          |
| Registry 模式支持自定义段落 | 便于插件扩展，第三方可以注册自己的提示词段落               |
| 环境上下文与构建器分离      | 环境检测是独立关注点，可被其他模块复用                     |
| 同步 + 异步双版本构建       | 同步版本用于快速启动，异步版本支持远程指令加载             |
| 类型与值分两个入口导出      | 遵循 verbatimModuleSyntax 规范，类型导入使用 `import type` |

## 故障排查

| 现象             | 可能原因               | 排查步骤                                            |
| ---------------- | ---------------------- | --------------------------------------------------- |
| 指令文件未加载   | 文件不在查找路径上     | 检查 cwd 到项目根目录之间是否有 AGENTS.md/CLAUDE.md |
| 模式指令未注入   | 模式名称拼写错误       | 确认 mode 参数是 6 种有效值之一                     |
| 构建后提示词为空 | 基础提示词选择失败     | 检查 model 参数是否匹配已知模型系列                 |
| 缓存未刷新       | 指令文件已修改但未重载 | 调用 `clearInstructionCache()` 后重新构建           |
| YOLO 标识未叠加  | enableYolo 参数未设置  | 确认 `enableYolo: true` 已传入构建选项              |
