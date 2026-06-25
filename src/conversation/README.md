# Conversation 模块 — 对话引擎

## 整体定位

Conversation 模块是 crab-cli 的核心对话引擎，负责协调 LLM 调用、工具执行、流式响应处理、上下文管理和生命周期控制。它在系统架构中扮演"对话编排器"的角色：上层（`@agent`、`@task`、`@server`）通过 `@conversation` 入口创建对话处理器，模块内部编排 LLM 循环、工具调用、压缩、摘要等复杂流程。

模块位于 `src/conversation/`，对外通过 `@conversation` 路径别名提供统一 API。重构后按业务域划分为 8 个子目录，职责清晰、单向依赖。

## 核心功能

1. **对话处理器** — `ConversationHandler` 核心类，管理消息历史、对话流程、流式响应
2. **LLM 循环编排** — 自动轮次管理、工具调用分类、死循环检测、中止信号处理
3. **工具执行管线** — 权限确认、Hook 拦截、批量执行、结果格式化
4. **流式处理** — 文本增量、thinking 提取、tool_call 解析、Token 计数
5. **上下文管理** — 代码库目录注入、会话状态查询、系统提示词构建
6. **上下文压缩** — Token 溢出检测、AI 摘要、工具输出截断、增量压缩
7. **安全守卫** — 死循环多策略检测、处理互斥锁、LLM 配置值对象
8. **生命周期** — 停止 Hook 处理、摘要生成、对话使用记忆
9. **旁路问答** — 独立 side-question 流，不写入对话历史

## 目录结构

```
src/conversation/
├── index.ts                    # 统一出入口，外部引用通过 @conversation 导入
├── README.md                   # 本文档
│
├── types/                      # ── 类型定义层 ──
│   ├── index.ts               # 统一导出
│   ├── message.ts             # 内部消息格式（ConversationMessage、MessagePart 等）
│   ├── handler.ts             # Handler 类型（ConversationResult、ToolInterceptor 等）
│   ├── loop.ts                # LLM 循环类型（LlmLoopOptions、StreamEvent 等）
│   └── driver.ts              # Driver 接口（ConversationDriver、SendMessageOptions）
│
├── core/                       # ── 核心引擎 ──
│   ├── index.ts               # 统一导出
│   ├── conversationHandler.ts # ConversationHandler 主类（对话编排核心）
│   ├── llmLoop.ts             # LLM 执行循环（流式调用、工具分类、事件分发）
│   ├── toolCallLoop.ts        # 工具调用循环（确认→执行→结果收集）
│   ├── toolExecution.ts       # 工具执行管线（批量编排、Hook、权限、结果处理）
│   └── goalIntegration.ts     # Goal Ralph Loop 集成（续接提示词注入）
│
├── stream/                     # ── 流式处理 ──
│   ├── index.ts               # 统一导出
│   ├── streamProcessor.ts     # LLM 流式响应处理（text/thinking/tool 事件）
│   ├── btwStream.ts           # 旁路问答（side-question 流式回答）
│   └── idleTimeoutGuard.ts    # 流式空闲超时守卫（Provider 挂起检测）
│
├── message/                    # ── 消息处理 ──
│   ├── index.ts               # 统一导出
│   ├── messageBuilder.ts      # 内部消息 ↔ AI SDK ModelMessage 格式转换
│   ├── messageFactories.ts    # 类型安全 ModelMessage 构造工厂
│   ├── thinkingExtractor.ts   # 思维链/推理内容提取（Anthropic/Responses/R1）
│   └── messagePartGuards.ts   # 消息片段类型守卫与归一化
│
├── context/                    # ── 上下文管理 ──
│   ├── index.ts               # 统一导出
│   ├── contextInjector.ts     # 代码库目录结构/最近文件 → 文本注入
│   ├── conversationSetup.ts   # 对话前准备（工具加载、上下文同步、清理）
│   ├── conversationSessionState.ts # 会话级只读状态（模式、白名单、动态提醒）
│   └── systemPrompt.ts        # 系统提示词构建（Skill + 编辑器上下文）
│
├── lifecycle/                  # ── 生命周期 ──
│   ├── index.ts               # 统一导出
│   ├── stopHandler.ts         # 对话停止后的 Hook 处理（JSON 指令解析）
│   ├── summaryGenerator.ts    # 对话历史结构化摘要生成（LLM + 规则后备）
│   └── conversationUsageMemory.ts # 对话使用记忆记录
│
├── compaction/                 # ── 上下文压缩 ──
│   ├── index.ts               # 统一导出
│   └── compaction.ts          # 压缩策略（findSplitIndex、maybeCompact、截断）+ Token 估算
│
└── guard/                      # ── 安全守卫 ──
    ├── index.ts               # 统一导出
    ├── doomLoop.ts            # 死循环多策略检测（连续重复/窗口序列/总轮次兜底）
    ├── doomLoopPolicy.ts      # 死循环检测 → 策略转换
    ├── processingGuard.ts     # 处理互斥锁 + 超时自动释放
    └── llmConfig.ts           # LLM 配置不可变值对象
```

## 子模块功能说明

| 子模块                                 | 职责                                            | 主要导出                                                                                                 |
| -------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `types/message.ts`                     | 内部消息格式                                    | `ConversationMessage`, `MessagePart`, `TokenInfo`, `ToolCallInfo`                                        |
| `types/handler.ts`                     | Handler 类型 + 辅助函数                         | `ConversationResult`, `ToolInterceptor`, `toToolResultOutput`, `normalizeToolCallArgs`                   |
| `types/loop.ts`                        | LLM 循环类型                                    | `LlmLoopOptions`, `StreamEvent`, `LlmLoopResult`, `MessageCompressor`                                    |
| `types/driver.ts`                      | Driver 接口                                     | `ConversationDriver`, `SendMessageOptions`, `ConversationDriverEvent`                                    |
| `core/conversationHandler.ts`          | 对话处理器主类                                  | `ConversationHandler`, `createConversationHandler`                                                       |
| `core/llmLoop.ts`                      | LLM 执行循环                                    | `executeLlmLoop`                                                                                         |
| `core/toolCallLoop.ts`                 | 工具调用循环                                    | `executeToolCallRound`, `toToolCallRequests`                                                             |
| `core/toolExecution.ts`                | 工具执行管线                                    | `executeToolCalls`, `HandlerContext`                                                                     |
| `core/goalIntegration.ts`              | Goal 集成                                       | `injectGoalContinuation`, `handleGoalPostTurn`, `GoalManagerAdapter`                                     |
| `stream/streamProcessor.ts`            | 流式处理器                                      | `processStream`, `mergeUsage`                                                                            |
| `stream/btwStream.ts`                  | 旁路问答                                        | `executeBtwStream`                                                                                       |
| `stream/idleTimeoutGuard.ts`           | 空闲超时守卫                                    | `createIdleTimeoutGuard`, `IdleTimeoutGuard`                                                             |
| `message/messageBuilder.ts`            | 消息格式转换                                    | `toModelMessages`, `buildParts`, `cleanOrphanedToolCallsFromModel`                                       |
| `message/messageFactories.ts`          | 消息工厂                                        | `createUserMessage`, `createAssistantMessage`, `createToolResultMessage`, `createModelMessageFromRecord` |
| `message/thinkingExtractor.ts`         | 思维提取                                        | `extractThinkingContent`, `extractReasoningAsThinking`, `cleanThinkingContent`                           |
| `message/messagePartGuards.ts`         | 类型守卫                                        | `isToolCallPart`, `isToolResultPart`                                                                     |
| `context/contextInjector.ts`           | 上下文注入                                      | `buildCodebaseContext`, `injectContextToMessage`                                                         |
| `context/conversationSetup.ts`         | 对话准备                                        | `prepareConversation`, `ConversationSetupResult`                                                         |
| `context/conversationSessionState.ts`  | 会话状态                                        | `getToolsForLlm`, `getAllowedToolsForExecution`, `buildSessionDynamicReminder`                           |
| `context/systemPrompt.ts`              | 系统提示词                                      | `getEffectiveSystemPrompt`                                                                               |
| `lifecycle/stopHandler.ts`             | 停止处理                                        | `handleStopHook`, `StopHookResult`                                                                       |
| `lifecycle/summaryGenerator.ts`        | 摘要生成                                        | `serializeMessages`, `generateSummary`                                                                   |
| `lifecycle/conversationUsageMemory.ts` | 使用记忆                                        | `recordConversationToolUsage`                                                                            |
| `compaction/compaction.ts`             | 压缩策略                                        | `maybeCompact`, `truncateToolOutputs`, `findSplitIndex`, `DEFAULT_COMPACTION_CONFIG`                     |
| `compaction/index.ts`                  | Token 估算（re-export from @core/tokenCounter） | `estimateMessagesTokens`, `estimateTokens`                                                               |
| `guard/doomLoop.ts`                    | 死循环检测                                      | `createDoomLoopState`, `detectDoomLoop`                                                                  |
| `guard/doomLoopPolicy.ts`              | 死循环策略                                      | `checkDoomLoop`, `resolveDoomLoopThreshold`                                                              |
| `guard/processingGuard.ts`             | 处理锁                                          | `ProcessingGuard`                                                                                        |
| `guard/llmConfig.ts`                   | LLM 配置                                        | `LlmConfig`                                                                                              |

## 使用方法

### 创建对话处理器

```typescript
import { ConversationHandler, type ConversationHandlerOptions } from "@conversation";

const handler = new ConversationHandler({
  maxToolRounds: 10,
  systemPrompt: "你是一个编程助手。",
  sessionId: "session-123",
  abortSignal: controller.signal,
  eventBus: globalBus,
});
```

### 发送消息

```typescript
const result = await handler.sendMessage("帮我分析这个函数");
console.log(result.text); // 响应文本
console.log(result.ok); // 是否成功
console.log(result.toolRounds); // 工具调用轮次
```

### 流式处理

```typescript
import { processStream } from "@conversation";

for await (const event of processStream(stream, {
  onToken: (text) => console.log(text),
  onToolCall: (call) => console.log(`调用工具: ${call.name}`),
  onUsage: (usage) => console.log(`Token: ${usage.total_tokens}`),
})) {
  // 处理流事件
}
```

### 上下文压缩

```typescript
import { maybeCompact, DEFAULT_COMPACTION_CONFIG } from "@conversation";

const result = await maybeCompact(messages, config, "session-123", DEFAULT_COMPACTION_CONFIG);
if (result?.compressed) {
  messages = result.messages;
}
```

### 旁路问答

```typescript
import { executeBtwStream } from "@conversation";

executeBtwStream("这个 API 怎么用？", config, history, (chunk) => {
  console.log(chunk); // 流式文本片段
});
```

## 与外部系统/模块的交互

| 外部模块                 | 交互方式  | 说明                                               |
| ------------------------ | --------- | -------------------------------------------------- |
| `@api/llm`               | 函数调用  | `streamLlm` 执行 LLM 流式调用                      |
| `@bus/eventBus`          | 发布/订阅 | `AppEvent` 通知 UI 更新（消息、工具调用、错误）    |
| `@tool/toolRegistry`     | 动态导入  | 获取已注册工具列表和工具 schema                    |
| `@tool/toolExecutor`     | 类实例化  | `ToolExecutor` 执行工具调用                        |
| `@permission/permission` | 类实例化  | `PermissionManager` 管理工具权限确认               |
| `@compress`              | 动态导入  | `compactSession` / `hybridCompactSession` 压缩对话 |
| `@session/*`             | 动态导入  | 会话消息读写、检查点管理                           |
| `@agent`                 | 动态导入  | Agent 状态保存/恢复                                |
| `@task/goalManager`      | 动态导入  | Goal Ralph Loop 集成                               |
| `@prompt/modes`          | 类型导入  | `ChatMode` 模式定义                                |
| `@skills`                | 单例      | Skill 上下文注入                                   |
| `@hooks/hookExecutor`    | 单例      | 工具调用 Hook、停止 Hook                           |
| `@ide/editorContext`     | 函数调用  | 编辑器上下文注入系统提示词                         |
| `@config/config`         | 常量导入  | `DEFAULT_CONFIG` 默认配置                          |
| `@rollback/branchPoints` | 动态导入  | 压缩分支点记录                                     |

## 设计原则

1. **单向依赖** — `types/` → `guard/` → `compaction/` → `message/` → `stream/` → `context/` → `lifecycle/` → `core/`
2. **子目录 index.ts 统一导出** — 内部使用 `./` 相对路径，外部使用 `@conversation/*` 别名
3. **无向后兼容桥接** — 根目录仅保留 `index.ts`（统一出入口）和 `type.ts`（纯类型出入口），所有业务代码迁移至子目录
4. **无状态设计** — 工具函数和类型定义无副作用，状态由 `ConversationHandler` 类管理
5. **事件驱动** — 所有状态变更通过 `EventBus` 发布，不直接操作 UI
