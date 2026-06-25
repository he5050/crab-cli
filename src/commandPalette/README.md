# CommandPalette 模块 — TUI 命令面板系统

## 整体定位

CommandPalette 模块是 `crab-cli` TUI 界面的命令面板核心系统，负责定义、注册、管理和执行所有用户可用的命令。它是 TUI 交互的枢纽层，连接用户操作与各业务模块的具体实现。

## 核心功能

1. **命令注册表** — 全局单例注册表，支持注册/注销、按名称/斜杠名查询、按分类过滤、Frecency 排序
2. **命令聚合工厂** — 将 7 个分类命令模块聚合为统一命令集合，依赖注入模式解耦命令与具体实现
3. **斜杠命令** — 支持 `/xxx` 格式的快速命令调用，含别名机制
4. **使用统计** — 自动记录命令使用频率和最近使用时间，支持 Frecency 排序推荐
5. **执行引擎** — 命令执行失败自动发布 Toast 错误通知，统一错误反馈

## 目录结构

```
src/commandPalette/
├── index.ts              # 值导出入口（@commandPalette），公共 API 统一引用
├── type.ts               # 类型导出入口（@commandPalette/type），所有类型定义
├── types.ts              # 核心类型定义（Command、CommandRegistry）
├── registry.ts           # 命令注册表实现（CommandRegistryImpl、getCommandRegistry）
├── appCommands.ts        # 命令聚合工厂（createAppCommands）
├── README.md             # 本文档
│
├── shared/               # 共享模块
│   └── index.ts          # 依赖注入接口（CommandDeps）+ 辅助工具
│
└── categories/           # 分类命令实现
    ├── config/           # 配置管理命令
    │   └── index.ts      # 配置+模式命令（Profile、模型、后端、深度、代理等）
    │
    ├── ide/              # IDE 和代码库命令
    │   ├── index.ts      # IDE 子模块统一出入口
    │   ├── ideCommands.ts # IDE 连接、诊断、LSP、WebSocket 服务端命令
    │   └── gitCodebase.ts # Git 操作（分支/Worktree/Diff/审查/Blame/标签）、代码库索引
    │
    ├── operational/      # 运维操作命令
    │   ├── index.ts      # Operational 子模块统一出入口
    │   ├── frameworkNavigation.ts # 框架级导航命令（退出、帮助、模式切换）
    │   ├── toolHookRoleSkill.ts   # 工具管理、Hook 管理、角色切换、技能加载
    │   ├── pluginWorkspaceCommands.ts # 插件市场与远程工作空间命令
    │   ├── quickCommands.ts       # 快捷工具命令（速度计、复制、导出、显示模式、通知）
    │   └── diagnosticCommands.ts  # 诊断与会话命令（环境检查、编辑器、面板操作、项目工具）
    │
    ├── session/          # 会话命令
    │   └── index.ts      # 会话管理（恢复、导出、压缩、快照、回滚、摘要、导入）
    │
    └── task/             # 任务管理命令
        ├── manageOther.ts # 任务循环、深度研究、目标管理、Todo、技能管理、自定义命令等
        └── todoPicker.ts  # Todo 选择器辅助函数
```

## 子模块说明

| 子模块                    | 职责                                                                       | 主要导出                                                                                                                                              |
| ------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `types.ts`                | 核心类型定义                                                               | `Command`, `CommandRegistry`                                                                                                                          |
| `registry.ts`             | 命令注册表（全局单例）                                                     | `getCommandRegistry`, `_resetCommandRegistryForTesting`                                                                                               |
| `appCommands.ts`          | 命令聚合工厂                                                               | `createAppCommands`, `CommandDeps`                                                                                                                    |
| `shared/index.ts`         | 依赖注入接口 + 辅助工具                                                    | `CommandDeps`, `NavigationDeps`, `getAppConfig`, `showErrorToast`                                                                                     |
| `categories/config/`      | 配置+模式命令（Profile、模型、后端、深度、代理、系统提示词）               | `buildConfigModeCommands`                                                                                                                             |
| `categories/ide/`         | IDE 和代码库命令（Git 操作、代码库索引、IDE 连接/LSP/WebSocket）           | `buildIdeCommands`, `buildGitCodebaseIdeCommands`                                                                                                     |
| `categories/operational/` | 运维操作命令（导航、工具/Hook/角色/技能、插件/远程工作区、快捷工具、诊断） | `buildFrameworkNavigationCommands`, `buildToolHookRoleSkillCommands`, `buildPluginWorkspaceCommands`, `buildQuickCommands`, `buildDiagnosticCommands` |
| `categories/session/`     | 会话命令（恢复、导出、压缩、快照、回滚、摘要、导入）                       | `buildSessionAgentCommands`                                                                                                                           |
| `categories/task/`        | 任务管理命令（循环、深度研究、目标、Todo、技能、自定义命令）               | `buildTaskManageOtherCommands`                                                                                                                        |

## 完整 API 导出

CLI 模块提供两个出入口文件：`index.ts`（值导出）和 `type.ts`（类型导出）。

### 类型导出（@commandPalette/type）

```typescript
import type {
  // 核心类型
  Command, // 命令定义接口（name、title、category、run 等）
  CommandRegistry, // 命令注册表接口（register、execute、listAll 等）

  // 依赖注入类型
  NavigationDeps, // 导航相关依赖（navigate、back、requestExit）
  UIDeps, // UI 反馈依赖（clearScreen、showToast）
  ConfigDeps, // 配置读取依赖（getConfig）
  SessionDeps, // 会话操作依赖（getCurrentSessionId、createSession）
  EventBusDeps, // 事件总线依赖（eventBus）
  CommandDeps, // 完整命令依赖（组合所有细粒度接口）
} from "@commandPalette/type";
```

### 值导出（@commandPalette）

```typescript
import {
  // ─── 核心功能 ──────────────────────────────────────────
  getCommandRegistry, // 获取命令注册表全局单例

  // ─── 命令工厂 ──────────────────────────────────────────
  createAppCommands, // 创建所有应用命令（接收 CommandDeps）

  // ─── 共享工具 ────────────────────────────────────────────
  getAppConfig, // 获取类型化的应用配置
  getErrorMessage, // 从未知错误中提取消息
  showErrorToast, // 显示错误 toast
} from "@commandPalette";
```

## 使用方法

### 应用初始化

```typescript
import { getCommandRegistry, createAppCommands } from "@commandPalette";
import type { CommandDeps } from "@commandPalette/type";

// 创建命令集合
const deps: CommandDeps = {
  navigate: (route) => {
    /* ... */
  },
  back: () => {
    /* ... */
  },
  requestExit: () => {
    /* ... */
  },
  showToast: (msg, variant) => {
    /* ... */
  },
  getConfig: () => currentConfig,
  eventBus: globalBus,
};

const commands = createAppCommands(deps);

// 注册到全局注册表
const registry = getCommandRegistry();
registry.registerAll(commands);
```

### 查询和执行命令

```typescript
const registry = getCommandRegistry();

// 按名称查询
const cmd = registry.get("app.quit");

// 按斜杠名查询
const slashCmd = registry.getBySlash("clear");

// 按分类列出
const configCmds = registry.listByCategory("配置");

// 列出所有斜杠命令
const slashCommands = registry.listSlashCommands();

// Frecency 排序（频率 + 最近使用时间）
const recommended = registry.sortByFrecency(registry.listAll());

// 执行命令
await registry.execute("app.quit");

// 执行斜杠命令（带参数）
const success = await registry.executeSlash("profile-switch", "production");
```

## 在系统架构中的作用

```
用户操作（键盘/鼠标）
       │
       ▼
┌──────────────────────────────────────────────────────┐
│              TUI UI 层（@ui/components）              │
│         CommandPalette 组件 / SlashCommand 输入        │
│                    │                                  │
│           getCommandRegistry()                        │
│                    │                                  │
└────────────────────┼──────────────────────────────────┘
                     │
┌────────────────────▼──────────────────────────────────┐
│        CommandPalette 模块（@commandPalette）           │
│  ┌───────────────────────────────────────────────┐   │
│  │  Registry (注册/查询/Frecency/执行)             │   │
│  │  ┌─ config/     ── 配置管理命令                  │   │
│  │  ├─ ide/        ── Git/索引/LSP 命令            │   │
│  │  ├─ operational ── 导航/工具/钩子/插件/诊断命令  │   │
│  │  ├─ session/    ── Agent 会话命令                │   │
│  │  └─ task/       ── 任务管理命令                  │   │
│  └───────────────────────────────────────────────┘   │
│  shared/ — CommandDeps 依赖注入                        │
└──────────────────────────────────────────────────────┘
                     │
                     ▼
┌──────────────────────────────────────────────────────┐
│  @agent │ @config │ @bus │ @tool │ @hooks │ @search   │
│  (模式)  (配置)   (事件) (工具)  (钩子)  (搜索)      │
└──────────────────────────────────────────────────────┘
```

## 与外部系统的交互

| 外部模块                         | 交互方式                    | 说明                               |
| -------------------------------- | --------------------------- | ---------------------------------- |
| `@ui/components`                 | 依赖 `getCommandRegistry()` | 命令面板组件获取命令列表和执行命令 |
| `@ui/pages`                      | 依赖 `getCommandRegistry()` | 帮助页、首页、会话页查询可用命令   |
| `@app.tsx`                       | 依赖 `createAppCommands()`  | 应用初始化时创建并注册所有命令     |
| `@agent`                         | 动态 `import()`             | 模式切换、Agent 状态查询           |
| `@config`                        | 动态 `import()`             | 配置读写、Profile 管理、Agent 加载 |
| `@config/settings/configManager` | 动态 `import()`             | Profile 切换/创建/删除             |
| `@bus`                           | 依赖 `globalBus`            | 发布 Toast 事件、命令执行反馈      |
| `@tool`                          | 动态 `import()`             | 工具注册查询、Git 操作             |
| `@hooks`                         | 动态 `import()`             | 钩子注册表和执行器                 |
| `@search`                        | 动态 `import()`             | 向量数据库和代码库索引             |
| `@permission`                    | 动态 `import()`             | 权限状态查询                       |
| `@session`                       | 动态 `import()`             | 消息共享、检查点管理               |
| `@prompt/builder`                | 依赖                        | 系统提示词预览                     |

## 命令分类体系

| 分类                | 说明                                  | 典型命令                                        |
| ------------------- | ------------------------------------- | ----------------------------------------------- |
| 配置                | Profile 管理、配置读写、Agent 配置    | `/profile-switch`, `/config-set`                |
| IDE                 | Git 操作、代码库索引、LSP 诊断        | `/git-status`, `/rebuild-index`, `/lsp-restart` |
| 导航                | 框架级导航和模式切换                  | 退出、帮助、模式切换                            |
| 工具/钩子/角色/技能 | 工具管理、钩子管理、角色切换          | `/tools`, `/hooks`, `/role-switch`              |
| 运维                | 插件市场、远程工作区、快捷工具、诊断  | `/plugin-market`, `/remote-workspace`           |
| 会话                | Agent 会话管理、消息操作、分支/检查点 | `/session-new`, `/undo`, `/branch`              |
| 任务                | Todo 管理、会话切换、导出             | `/todo`, `/export`                              |

## 设计决策

| 决策                     | 原因                                                                         |
| ------------------------ | ---------------------------------------------------------------------------- |
| 全局单例注册表           | 命令注册表在应用生命周期内唯一，避免传递实例                                 |
| 依赖注入（CommandDeps）  | 命令实现不直接依赖全局状态，便于测试和替换                                   |
| 动态 `import()` 懒加载   | 工具/钩子等模块按需加载，减少启动时间和内存                                  |
| Frecency 排序            | 结合使用频率和最近时间，比纯频率或纯 LRU 更智能                              |
| 双出入口（index + type） | 值/类型分离，改善 tree-shaking，类型无需加载运行时代码                       |
| 分类子目录               | 按业务域划分命令（config/ide/operational/session/task），职责清晰            |
| 路径别名引用             | 所有外部模块通过 `@config`、`@tool`、`@hooks` 等别名引用，避免脆弱的相对路径 |

## 错误处理

命令执行失败时统一通过事件总线发布 Toast 通知：

```typescript
// registry.ts 中的统一错误处理
try {
  await cmd.run();
} catch (error) {
  this.eventBus.publish(AppEvent.Toast, {
    message: `命令执行失败: ${name} — ${message}`,
    variant: "error",
  });
}
```

## 边界与限制

1. **命令名称唯一** — 注册表中命令 name 必须唯一，重复注册会覆盖
2. **内存存储** — 命令定义和使用统计不持久化，应用重启后重置
3. **进程内单例** — 注册表为进程内实现，不支持跨进程共享
4. **斜杠命令不含前导 `/`** — `slashName` 字段存储的是不含 `/` 的名称，如 `"clear"`
5. **动态导入依赖运行时** — 部分命令通过 `import()` 懒加载模块，如果模块不存在会在运行时报错

## 测试支持

```typescript
import { _resetCommandRegistryForTesting, getCommandRegistry } from "@commandPalette";

// 测试隔离：重置注册表单例
_resetCommandRegistryForTesting();
const registry = getCommandRegistry();
// 注册测试命令...
```

## 相关测试

| 测试文件                                                | 覆盖范围             |
| ------------------------------------------------------- | -------------------- |
| `test/unit/commandPalette/appCommandsStructure.test.ts` | 命令聚合结构         |
| `test/unit/commandPalette/commandIntegration.test.ts`   | 命令集成测试         |
| `test/unit/commandPalette/commandPalette.test.ts`       | 命令面板组件测试     |
| `test/unit/commandPalette/commandPalette.test.tsx`      | 命令面板组件 UI 测试 |
| `test/unit/commandPalette/commands.test.ts`             | 命令执行测试         |
| `test/unit/commandPalette/registry.test.ts`             | 注册表功能测试       |
| `test/unit/commandPalette/todoListScan.test.ts`         | Todo 扫描测试        |
