# @config — 配置系统

## 整体定位

Config 模块是 crab-cli 的核心基础设施之一，负责管理应用的全局配置、路径解析、设置存储、Agent 定义、主题系统、功能开关和类型验证。它采用分层架构，支持全局配置（`~/.crab/config.json`）、项目级配置（`.crab/config.json`）、Profile 覆盖和环境变量四级优先级覆盖。几乎所有其他模块都依赖此模块获取运行时配置。

## 核心功能

1. **配置加载与持久化** — 分层配置加载引擎，支持 Zod 验证、热重载、环境变量覆盖、原子更新、版本管理和来源追踪
2. **路径解析** — XDG 规范路径计算、全局/项目配置路径、向上查找、多工作目录管理（支持 SSH 远程目录）
3. **全局常量** — 62 应用常量集中管理：超时、缓存、限流、监控、Agent 限制等
4. **设置管理** — 统一设置存储（`settings.json`），支持 global/project/session 三作用域；项目级模式开关、Profile CRUD、高级配置操作
5. **Agent 定义与管理** — 12 个内置子代理 + 5 个主代理的完整定义（boundaries、capabilities、tools），用户自定义子代理 CRUD 与持久化
6. **主题系统** — 主题注册表、32 暗色 + 3 亮色预置主题、OpenCode 扩展 tokens、自定义主题加载
7. **功能开关与特性配置** — 技能/工具/MCP 工具禁用开关、60+ 默认权限规则、Hook 文件持久化、代理配置与 Relay Provider 检测、AI Provider 元数据注册表
8. **类型与验证** — 主题颜色与扩展 token 类型定义、通用配置验证框架（类型检查、规则验证、默认值收集，当前预留未集成）

## 目录结构

```
src/config/
├── index.ts              # 统一出入口，所有外部引用通过此文件
├── type.ts               # 统一类型出入口，所有公开类型集中导出
├── README.md             # 本文档
│
├── loader/               # 配置加载与持久化
│   ├── config.ts         # 分层加载、热重载、deepMerge
│   ├── atomicConfig.ts   # 原子更新、版本管理、ConfigVersionWatcher
│   ├── configSources.ts  # 来源追踪（default/global/project/env）
│   └── errors.ts         # 错误格式化（内部使用）
│
├── paths/                # 路径解析
│   ├── index.ts          # 统一导出 paths.ts + workingDir.ts
│   ├── paths.ts          # XDG 路径、全局/项目路径
│   └── workingDir.ts     # 多工作目录、SSH 远程目录
│
├── constants/            # 全局常量
│   └── index.ts          # 62 个应用常量（超时、缓存、限流等）
│
├── settings/             # 设置管理
│   ├── unifiedSettings.ts  # settings.json 统一存储（三作用域）
│   ├── projectSettings.ts  # 项目级模式开关
│   ├── profileManager.ts   # Profile CRUD
│   └── configManager.ts    # 高级配置操作
│
├── agents/               # Agent 定义与管理
│   ├── agentDefinitions.ts # 内置 Agent 定义（boundaries、capabilities、tools）
│   ├── agentConfig.ts      # 内置 Agent 列表与查找
│   ├── subAgentConfig.ts   # 用户子代理 CRUD
│   └── agentLoader.ts      # roles.json 加载器
│
├── themes/               # 主题系统
│   ├── themeConfig.ts      # 主题注册表、自定义主题加载
│   ├── themesDark.ts       # 32 暗色主题
│   ├── themesLight.ts      # 3 亮色主题
│   └── themesOpenCodeExtended.ts # OpenCode 扩展 tokens
│
├── features/             # 功能开关与特性配置
│   ├── apiConfig.ts           # Provider 元数据注册表
│   ├── disabledMcpTools.ts    # MCP 工具禁用开关
│   ├── disabledSkills.ts      # 技能禁用开关
│   ├── disabledTools.ts       # 内置服务禁用开关
│   ├── hooksConfig.ts         # Hook 文件持久化
│   ├── permissionsConfig.ts   # 60+ 默认权限规则
│   ├── proxyConfig.ts         # 代理与 Relay 检测
│   └── toolDisplayConfig.ts   # TUI 显示策略
│
└── types/                # 类型与验证
    ├── themeTypes.ts     # 主题类型定义
    └── schema.ts         # 通用验证框架
```

## 子模块说明

| 子模块       | 职责         | 主要导出                                                                                                                                 |
| ------------ | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `loader/`    | 配置加载引擎 | `loadConfig`, `saveConfig`, `deepMerge`, `config`, `ConfigLoader`, `ConfigVersion`, `ConfigSource`                                       |
| `paths/`     | 路径解析     | `getGlobalConfigPath`, `getProjectConfigPath`, `getCrabDir`, `getProfilesDir`, `WorkingDirectory`, `SSHConfig`                           |
| `constants/` | 全局常量     | `MAX_SPAWN_DEPTH`, `DEFAULT_MAX_TOOL_ROUNDS`, `COMPRESSION_LOCK_TIMEOUT_MS` 等 62 个常量                                                 |
| `settings/`  | 设置管理     | `readMergedSettings`, `updateSettings`, `ProfileManager`, `ProjectSettings`, `UnifiedSettings`                                           |
| `agents/`    | Agent 定义   | `getBuiltinAgentDefinition`, `getSubAgents`, `SubAgent`, `BuiltinAgentDef`                                                               |
| `themes/`    | 主题系统     | `getThemeDefinition`, `listThemes`, `ThemeDefinition`, `resolveThemeColors`                                                              |
| `features/`  | 功能开关     | `isBuiltInServiceEnabled`, `getDisabledBuiltInServices`, `isMCPToolEnabled`, `isSkillEnabled`, `ProxyInfo`, `HookConfig`, `ProviderMeta` |
| `types/`     | 类型与验证   | `ThemeColors`, `ExtendedThemeColors`, `ValidationRule`, `FieldSchema`, `ConfigSchema`                                                    |

## 完整 API 导出

以下为 `index.ts` 导出的完整清单，所有外部模块应通过 `@config` 统一入口引用：

### 类型导出（通过 `@config/type` 或 `@config`）

```typescript
import type {
  // ─── 加载层 ──────────────────────────────────────────
  ConfigLoader, // 配置加载器接口
  ConfigVersion, // 配置版本信息
  AtomicUpdateOptions, // 原子更新选项
  ConfigSource, // 配置来源（default/global/project/env）
  ConfigSourceInfo, // 配置来源详情

  // ─── 路径 ────────────────────────────────────────────
  SSHConfig, // SSH 远程配置
  WorkingDirectory, // 工作目录信息
  WorkingDirConfig, // 工作目录配置

  // ─── 设置 ────────────────────────────────────────────
  UnifiedSettings, // 统一设置结构
  PersistentSettingsScope, // 持久化作用域（project/global）
  SettingsScope, // 设置作用域（含 session）
  ProjectSettings, // 项目级模式开关
  ProfileInfo, // Profile 信息

  // ─── Agent ──────────────────────────────────────────
  BuiltinAgentDef, // 内置 Agent 定义
  SubAgent, // 子代理定义
  SubAgentsConfig, // 子代理配置
  AgentConfig, // 角色配置

  // ─── 主题 ────────────────────────────────────────────
  ThemeMode, // 主题模式（dark/light）
  ThemeColors, // 基础主题颜色
  ExtendedThemeColors, // 完整主题颜色
  ThemeExtendedOverrides, // 扩展 token 覆盖
  ThemeDefinition, // 主题定义
  // + DiffColors, MarkdownColors, SyntaxColors 等

  // ─── 特性 ────────────────────────────────────────────
  ProxyInfo, // 代理信息
  MCPConfigScope, // MCP 配置作用域
  ProviderMeta, // Provider 元数据
  HookActionType,
  HookAction,
  HookRule,
  HookConfig, // Hook 配置
  // + 各 Hook 上下文类型（OnUserMessageContext 等）

  // ─── Schema ─────────────────────────────────────────
  ConfigValueType, // 配置值类型
  ValidationRule, // 验证规则
  FieldSchema, // 字段 Schema
  ConfigSchema, // 配置 Schema
  ValidationResult, // 验证结果
} from "@config";
```

### 值导出（通过 `@config`）

```typescript
import {
  // ─── 核心加载 ────────────────────────────────────────
  loadConfig, // 加载配置（自动缓存）
  saveConfig, // 保存配置
  deepMerge, // 深度合并
  config, // 当前配置引用
  resetConfigCache, // 重置缓存
  startConfigWatch, // 开始文件监听
  stopConfigWatch, // 停止文件监听
  DEFAULT_CONFIG, // 默认配置
  parseConfig, // 解析配置

  // ─── 原子更新 ────────────────────────────────────────
  atomicUpdateGlobalConfig, // 原子更新全局配置
  atomicUpdateProjectConfig, // 原子更新项目配置
  ConfigVersionWatcher, // 版本观察器
  getVersionHistory, // 版本历史
  cleanupOldBackups, // 清理旧备份

  // ─── 路径 ────────────────────────────────────────────
  getGlobalCrabDir, // 全局 .crab 目录
  getConfigDir, // 配置目录
  getGlobalConfigPath, // 全局配置路径
  getCrabDir, // 项目 .crab 目录
  getProfilesDir, // Profiles 目录
  getGlobalTmpDir, // 全局临时目录
  loadWorkingDirConfig, // 加载工作目录配置
  addWorkingDirectory, // 添加工作目录

  // ─── 常量 ────────────────────────────────────────────
  MAX_SPAWN_DEPTH,
  DEFAULT_MAX_TOOL_ROUNDS,
  COMPRESSION_LOCK_TIMEOUT_MS,
  // ... 62 个常量

  // ─── 设置 ────────────────────────────────────────────
  readSettings,
  writeSettings,
  updateSettings,
  readMergedSettings, // 读取合并设置
  ProfileManager, // Profile 管理器
  getProfileManager,

  // ─── Agent ──────────────────────────────────────────
  getBuiltinAgentDefinition,
  getSubAgents,
  createSubAgent,
  updateSubAgent,
  deleteSubAgent,

  // ─── 主题 ────────────────────────────────────────────
  getThemeDefinition,
  listThemes,
  resolveThemeColors,

  // ─── 特性 ────────────────────────────────────────────
  isBuiltInServiceEnabled,
  getDisabledBuiltInServices,
  isMCPToolEnabled,
  toggleMCPTool,
  isSkillEnabled,
  toggleSkill,
  getProviderMeta,
  getDefaultPermissions,

  // ─── ConfigManager ──────────────────────────────────
  listProfiles,
  switchProfile,
  createProfile,
  deleteProfile,
  backupConfig,
  resetConfig,
} from "@config";
```

## 使用方法

### 基本使用

```typescript
import { loadConfig, saveConfig, DEFAULT_CONFIG } from "@config";

const config = await loadConfig();
await saveConfig({ theme: "dracula" });
console.log(DEFAULT_CONFIG);
```

### 路径解析

```typescript
import { getGlobalConfigPath, getProjectConfigPath, getProfilesDir } from "@config";

const globalPath = getGlobalConfigPath(); // ~/.crab/config.json
const projectPath = getProjectConfigPath(cwd); // 向上查找 .crab/config.json
const profilesDir = getProfilesDir(); // ~/.crab/profiles/
```

### 常量

```typescript
import { MAX_SPAWN_DEPTH, DEFAULT_MAX_TOOL_ROUNDS, COMPRESSION_LOCK_TIMEOUT_MS } from "@config";
```

### 设置存储

```typescript
import { readMergedSettings, updateSettings } from "@config";

const settings = readMergedSettings();
updateSettings("project", (s) => {
  s.yoloMode = true;
});
```

### Agent 定义

```typescript
import { getBuiltinAgentDefinition, getSubAgents } from "@config";

const explore = getBuiltinAgentDefinition("explore");
const allAgents = getSubAgents(); // 内置 + 用户自定义
```

### 主题

```typescript
import { getThemeDefinition, listThemes } from "@config";

const theme = getThemeDefinition("dracula");
const allThemes = listThemes();
```

## 与外部系统的交互

### 配置加载优先级（高 → 低）

1. **环境变量** — `CRAB_API_KEY`, `CRAB_MODEL`, `CRAB_PROVIDER`, `CRAB_PROXY`, `CRAB_DEV`
2. **项目级配置** — `.crab/config.json`（向上查找）
3. **Profile 覆盖** — `~/.crab/profiles/<name>.json`
4. **全局配置** — `~/.crab/config.json`
5. **默认值** — `AppConfigSchema.parse({})`

### 外部模块交互

| 外部模块                | 交互方式          | 说明                                                                |
| ----------------------- | ----------------- | ------------------------------------------------------------------- |
| `@schema/config`        | 接收 Zod Schema   | 配置系统使用 `src/schema/config.ts` 中的 `AppConfigSchema` 验证配置 |
| `@bus/eventBus`         | 发布事件          | 配置变更通过 `AppEvent.ConfigUpdated` 通知所有订阅者                |
| `@core/errors/appError` | 错误处理          | `ToolError` 用于原子写入时的锁超时等场景                            |
| `@core/logger`          | 日志记录          | 配置加载/解析过程的调试信息输出                                     |
| `@agent`                | 提供 Agent 定义   | Agent 模块通过 `getBuiltinAgentDefinition` 加载内置 Agent           |
| `@conversation`         | 提供压缩/会话配置 | 使用常量模块中的 `COMPRESSION_LOCK_TIMEOUT_MS` 等                   |

### 文件监听

配置系统支持热重载，通过 `ConfigVersionWatcher`（基于版本号检测）或 `fs.watch`（回退方案）监听配置文件变化。使用 `pauseConfigWatch()` / `resumeConfigWatch()` 可在保存时避免循环触发。

### 原子更新

所有配置写入通过 `atomicUpdateGlobalConfig` 实现：写入临时文件 → `renameSync`（POSIX 原子操作）→ `chmod 0o600`。支持版本冲突检测（`expectedVersion` 选项）。

## 边界与限制

1. **配置变更不强制重启** — 热重载生效范围受限于各模块的缓存策略，部分配置项变更后需新的会话周期才能生效
2. **路径解析基于 XDG 规范** — 不支持 Windows 平台路径约定
3. **原子写入为进程级** — 不支持跨进程的分布式锁，`ConfigVersionWatcher` 的版本号在同一进程内有效
4. **常量不可运行时修改** — `constants/` 中的常量是编译时确定的，修改需重新编译
5. **Agent 定义固定** — 内置 Agent 定义不可覆盖，仅可扩展子代理（`subAgentConfig`）
6. **主题无自动切换** — 主题切换需显式调用 `getThemeDefinition` 重新获取
7. **无 Schema 版本迁移** — 当前 `AppConfigSchema` 变更时，旧配置字段会被 `parseConfig` 静默丢弃（`unrecognized_keys` 剥离 + Toast 通知）。未来需要增加 `_metadata.schemaVersion` + 迁移函数注册表，确保用户升级后旧配置不丢失

## 待改进（P2/P3）

- [P2] Config Schema 版本迁移骨架 — 在 `loadConfig` 中增加 `migrateConfig()` 阶段（`_metadata.schemaVersion` + 迁移函数注册表），确保 Schema 变更时旧配置不静默丢失
- [P2] 常量命名空间分组 — 按域分组为子对象（Breaking change，需渐进迁移）

### 已完成

- ~~[P2] `agentLoader.ts` 与 `@/agent` 解耦~~ — 已通过 lazy dynamic import 消除循环依赖
- ~~[P2] `profileManager.switchProfile` 改用原子写入~~ — 已改用 tmpfile + renameSync 原子模式
- ~~[P2] `projectSettings.ts` getter 缓存~~ — 已增加 100ms TTL 缓存，写入时失效
- ~~[P2] `types/schema.ts` 验证框架定位~~ — 已标记 `@internal`，明确为预留 API
- ~~[P2] `subAgentConfig.ts` I/O 模式统一~~ — 已将 `readFileSync`/`writeFileSync` 改为 `readJsonFile`/`writeJsonFile`（async），所有 CRUD 函数同步转异步
- ~~[P3] ConfigVersionWatcher mtime 优化~~ — 已增加 `statSync().mtimeMs` 前置检查，未变化时跳过内容读取
- ~~[P3] 并发场景测试~~ — 已覆盖 `loadConfig` 幂等性、`atomicUpdate` 版本冲突、`parseConfig` 边界输入、`ConfigVersionWatcher` 生命周期等 14 个新增测试
