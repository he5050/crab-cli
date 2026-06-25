# Hooks 模块 — Hook 事件系统

## 整体定位

Hooks 模块是系统的可扩展事件机制，允许在工具调用前后、会话生命周期、子代理事件、用户消息等关键时刻插入自定义逻辑（Shell 命令、内置函数、AI 判断）。它提供注册/执行/策略解释的完整链路，支持优先级排序、条件过滤、超时控制和容错处理。

## 核心功能

1. **Hook 注册表** — 全局单例，支持注册/注销/查询/条件过滤/优先级排序
2. **Hook 执行器（注册表驱动）** — 基于 hookRegistry 执行 shell 和 builtin 类型 Hook，发布 EventBus 事件
3. **统一执行器（配置文件驱动）** — 基于 `.crab/hooks/{event}.json` 配置文件执行 command 和 prompt 类型 Hook
4. **策略解释器** — 11 种事件类型的独立策略，将执行结果映射为 continue/block/replace/warn
5. **Shell Hook** — 通过环境变量 + stdin JSON 传递上下文，stdout JSON 返回决策
6. **内置 Hook** — 4 个开箱即用 Hook（日志、安全检查、会话开始/结束）
7. **状态栏 Hook** — 从 Notification Hook 获取自定义状态栏内容

## 目录结构

```
src/hooks/
├── index.ts                  # 统一出口（barrel export）
├── types.ts                 # 核心类型定义（HookEvent, HookContext, HookDecision 等）
├── hookRegistry.ts          # Hook 注册表（全局单例 + JSON 持久化）
├── hookExecutor.ts          # Hook 执行器（基于注册表，shell + builtin）
├── hookStrategies.ts        # 11 种事件策略解释器
├── unifiedHookExecutor.ts   # 配置文件驱动执行器（command + prompt）
├── builtinHooks.ts          # 4 个内置 Hook
├── shellHook.ts             # Shell 命令执行器
└── statuslineHook.ts        # 状态栏 Hook
```

## 两套执行系统

本项目存在两套并行的 Hook 执行系统，各有适用场景：

| 特性      | HookExecutor             | UnifiedHooksExecutor                       |
| --------- | ------------------------ | ------------------------------------------ |
| 数据源    | hookRegistry（内存注册） | `@config/features/hooksConfig`（配置文件） |
| Hook 类型 | shell + builtin          | command + prompt                           |
| 配置方式  | 程序化 API `register()`  | 文件系统 `.crab/hooks/{event}.json`        |
| 消费者    | 11 个模块（主流路径）    | 1 个模块（toolApproval）                   |
| 适用场景  | 需要动态注册/内置 Hook   | 需要文件化配置/用户自定义                  |

**选择指南**：大多数场景使用 `hookExecutor`（注册表驱动），仅在需要从配置文件加载用户自定义 Hook 时使用 `unifiedHooksExecutor`。

## 11 种 Hook 事件

| HookEvent          | 配置键               | 触发时机       | 决策影响                |
| ------------------ | -------------------- | -------------- | ----------------------- |
| `PreToolUse`       | `beforeToolCall`     | 工具调用前     | block 阻止执行          |
| `PostToolUse`      | `afterToolCall`      | 工具调用后     | replace 替换结果        |
| `UserMessage`      | `onUserMessage`      | 用户发送消息时 | replace 替换消息        |
| `ToolConfirmation` | `toolConfirmation`   | 工具权限确认时 | block 阻止确认          |
| `Compress`         | `beforeCompress`     | 上下文压缩前后 | block 阻止压缩          |
| `Notification`     | `onNotification`     | 通知事件       | warn 警告继续           |
| `Stop`             | `onStop`             | 对话停止       | inject 注入消息继续对话 |
| `SubAgentStart`    | `onSubAgentStart`    | 子代理启动     | block 阻止启动          |
| `SubAgentStop`     | `onSubAgentComplete` | 子代理停止     | inject 注入消息         |
| `SessionStart`     | `onSessionStart`     | 会话开始       | warn 警告继续           |
| `SessionEnd`       | `onSessionEnd`       | 会话结束       | warn 警告继续           |
| `SkillExecute`     | `onSkillExecute`     | Skill 执行前后 | block 阻止执行          |

## 决策类型

```typescript
type HookDecision =
  | { action: "pass" } // 放行
  | { action: "block"; reason?: string } // 阻止
  | { action: "replace"; output: unknown } // 替换结果
  | { action: "inject"; message: string; shouldContinueConversation?: boolean }; // 注入消息
```

## 完整 API 导出

### 类型导出

```typescript
import type {
  HookEvent, // 11 种 Hook 事件类型
  HookType, // "shell" | "builtin" | "prompt"
  HookContext, // Hook 执行上下文
  HookDecision, // Hook 决策类型
  HookDefinition, // Hook 定义接口
  HookResult, // 完整 Hook 执行结果
  AnyHookResult, // HookResult | HookActionResult 联合类型
  CommandHookResult, // Shell/Prompt 执行的命令结果
  PromptHookResult, // Prompt 执行结果
  PromptHookResponse, // Prompt 响应格式
  HookActionResult, // CommandHookResult | PromptHookResult
  StatusLineSegment, // 状态栏段
  StatusLineHookResult, // 状态栏 Hook 结果
  InterpretedHookResult, // 策略解释后的结构化结果
  UnifiedHookExecutionResult, // 统一执行器整体结果
} from "@hooks";
```

### 值导出

```typescript
import {
  // ─── 注册表 ──────────────────────────────────────
  hookRegistry, // Hook 注册表实例

  // ─── 执行器（注册表驱动）─────────────────────────
  HookExecutor, // Hook 执行器类
  hookExecutor, // Hook 执行器实例

  // ─── 策略解释器 ─────────────────────────────────
  interpretHookResult, // 统一的结果解释入口
  hookStrategies, // 所有事件的策略映射

  // ─── 统一执行器（配置文件驱动）──────────────────
  UnifiedHooksExecutor, // 统一执行器类
  unifiedHooksExecutor, // 统一执行器实例

  // ─── Shell Hook ──────────────────────────────────
  executeShellHook, // 执行 Shell 命令 Hook

  // ─── 内置 Hook ──────────────────────────────────
  builtinHooks, // 4 个内置 Hook 定义数组
  registerBuiltinHooks, // 注册所有内置 Hook

  // ─── 状态栏 Hook ────────────────────────────────
  executeStatusLineHooks, // 执行状态栏 Hook
  formatStatusLine, // 格式化状态栏内容
  getDefaultStatusLine, // 获取默认状态栏内容
} from "@hooks";
```

## 使用方法

### 注册和执行 Builtin Hook

```typescript
import { hookRegistry, hookExecutor } from "@hooks";

// 注册自定义 Hook
hookRegistry.register({
  id: "my-hook",
  name: "My Custom Hook",
  event: "PreToolUse",
  type: "builtin",
  enabled: true,
  priority: 50,
  condition: { toolName: "bash" },
  handler: async (ctx) => {
    if (ctx.toolName === "bash" && ctx.toolArgs?.command?.includes("rm -rf")) {
      return { action: "block", reason: "禁止删除根目录" };
    }
    return { action: "pass" };
  },
});

// 工具调用前自动执行
const { allowed, reason } = await hookExecutor.preToolUse("bash", { command: "ls" });
if (!allowed) {
  console.log(`工具调用被阻止: ${reason}`);
}
```

### Shell Hook 通信协议

Hook 脚本通过以下方式与 crab-cli 通信：

**输入：**

- 环境变量：`CRAB_HOOK_EVENT`, `CRAB_TOOL_NAME`, `CRAB_SESSION_ID`, `CRAB_TOOL_CALL_ID`, `CRAB_AGENT_ID`, `CRAB_AGENT_NAME`, `CRAB_IS_ERROR`
- stdin JSON：`{ event, toolName, sessionId, toolArgs, toolResult }`

**输出（stdout JSON）：**

```jsonc
// 放行
{ "decision": "pass" }

// 阻止
{ "decision": "block", "reason": "安全检查未通过" }

// 替换结果
{ "decision": "replace", "output": { ... } }
```

**退出码：**

- `0` — 成功
- 非 `0` — 失败（容错处理，默认放行）

### 策略解释

```typescript
import { interpretHookResult } from "@hooks";

const results = await hookExecutor.execute("PreToolUse", { toolName: "bash" });
const interpreted = interpretHookResult("PreToolUse", results);

switch (interpreted.action) {
  case "continue":
    break; // 继续执行
  case "block": // 阻止，检查 errorDetails
  case "replace": // 替换，使用 replacedContent
  case "warn": // 警告，检查 warningMessage
}
```

## 与外部系统的交互

| 外部模块                                                         | 导入内容                                      | 使用场景                                     |
| ---------------------------------------------------------------- | --------------------------------------------- | -------------------------------------------- |
| `src/conversation/core/conversationHandler.ts`                   | `hookExecutor`                                | 主对话循环中执行 PreToolUse/PostToolUse Hook |
| `src/conversation/core/toolExecution.ts`                         | `hookExecutor`                                | 工具执行前后 Hook                            |
| `src/conversation/lifecycle/stopHandler.ts`                      | `hookExecutor`                                | 对话停止时执行 Stop Hook                     |
| `src/agent/session/sessionDeps.ts`                               | `hookExecutor`                                | Agent 会话中的 Hook 执行                     |
| `src/agent/subagent/toolApproval.ts`                             | `unifiedHooksExecutor`, `interpretHookResult` | 子代理工具审批中使用统一执行器 + 策略        |
| `src/agent/team/execution/teamRegularToolExecutor.ts`            | `hookExecutor`                                | 团队模式工具执行 Hook                        |
| `src/agent/team/mate/teamMateLifecycle.ts`                       | `hookExecutor`                                | 团队成员生命周期 Hook                        |
| `src/compress/core/compressor.ts`                                | `hookExecutor`                                | 压缩前后执行 Compress Hook                   |
| `src/compress/conversation/compaction.ts`                        | `hookExecutor`                                | 对话压缩 Hook                                |
| `src/extension/skill/manager/index.ts`                           | `hookExecutor`                                | Skill 执行 Hook                              |
| `src/config/features/hooksConfig.ts`                             | `HookEvent` (type)                            | Hook 配置持久化                              |
| `src/commandPalette/categories/operational/toolHookRoleSkill.ts` | `HookDefinition`, `HookResult` (type)         | 命令面板中显示 Hook 信息                     |
| `test/setup.ts`                                                  | mock.module rebinding                         | 测试间隔离 Hook 模块                         |

## 配置项

| 配置项               | 来源                                               | 说明                |
| -------------------- | -------------------------------------------------- | ------------------- |
| Hook 超时            | HookDefinition.timeout（默认 30000ms）             | Shell Hook 执行超时 |
| 统一执行器超时       | UnifiedHooksExecutor.defaultTimeout（默认 5000ms） | 配置文件 Hook 超时  |
| 配置文件目录（全局） | `~/.crab/hooks/`                                   | 全局 Hook 配置      |
| 配置文件目录（项目） | `.crab/hooks/`                                     | 项目级 Hook 配置    |

## 边界与限制

1. **HookExecutor 的 PreToolUse 事件** — 如果某个 Hook 返回 block，后续 Hook 不再执行
2. **容错机制** — Hook 执行失败（异常、超时、非零退出码）默认 pass，不阻塞主流程
3. **Shell Hook 命令分割** — `executeShellHook` 使用 `command.split(/\s+/)` 分割，不支持 shell 引号语法
4. **UnifiedHooksExecutor exitCode** — command 类型 exitCode >= 2 时停止后续 Action
5. **prompt 类型限制** — 仅允许 onStop 和 onSubAgentComplete 事件使用 prompt 类型
6. **执行日志** — hookExecutor 最多保留 200 条执行记录

## 设计决策

| 决策               | 原因                                                                              |
| ------------------ | --------------------------------------------------------------------------------- |
| 两套执行系统并存   | 注册表驱动适合内置/程序化 Hook，配置文件驱动适合用户自定义 Hook，两者服务不同场景 |
| Hook 失败默认 pass | CLI 工具不应因 Hook 故障阻塞用户工作流                                            |
| 优先级排序         | priority 数值越小越先执行，确保安全检查等关键 Hook 优先运行                       |
| 条件过滤           | 支持 toolName 匹配，避免无关 Hook 被触发                                          |
| EventBus 发布      | Hook 执行结果通过事件总线广播，便于 UI 层实时展示                                 |
| 策略模式           | 每种事件类型有独立的解释策略，灵活处理不同事件的语义差异                          |

## 故障排查

| 现象                              | 可能原因                 | 排查步骤                                     |
| --------------------------------- | ------------------------ | -------------------------------------------- |
| Hook 未触发                       | 未注册或 enabled=false   | 检查 hookRegistry.getAll() 确认状态          |
| PreToolUse block 后续 Hook 不执行 | 符合设计预期             | 如需全部执行，避免在 PreToolUse 中返回 block |
| Shell Hook 超时                   | 命令执行时间超过 timeout | 增大 HookDefinition.timeout 或优化脚本       |
| Shell Hook 命令参数解析异常       | 使用了 shell 引号语法    | `split(/\s+/)` 不支持引号，用脚本文件替代    |
| 配置文件 Hook 未加载              | 文件路径或格式错误       | 检查 `.crab/hooks/{event}.json` 格式         |
