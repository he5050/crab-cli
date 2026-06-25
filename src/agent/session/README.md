# Agent Session 模块

Agent 执行上下文的协调器，管理对话生命周期、子代理编排、工具拦截和消息序列化。

## 目录结构

```
session/
├── session.ts            # 协调器 — AgentSession 类（公开 API 入口）
├── sessionDeps.ts       # 依赖注入单例 + 测试替身管理
├── sessionLifecycle.ts  # 状态机 + 销毁清理
├── sessionToolContext.ts # 工具拦截器 + ToolContext 工厂
├── sessionSubagent.ts   # 子代理编排（spawnSubagent + createSpawnExecutor + spawnToolSubagent）
├── hookManager.ts       # 生命周期钩子管理器（优先级、once、异步收敛）
├── serializer.ts         # 消息序列化/反序列化 + 版本迁移 + SHA-256 校验和
├── model.ts             # Agent 模型解析（Provider/Model 选择）
├── types.ts             # 统一类型导出
└── README.md
```

## 核心概念

### AgentSession

主类，封装单个 Agent 的完整执行上下文：

```typescript
const session = new AgentSession("code-agent", config, {
  spawnDepth: 0,
  maxSpawnDepth: 3,
  sessionId: "session-1",
});

const result = await session.sendMessage("请帮我实现 XX 功能");
console.log(result.ok, result.text, result.toolRounds);
session.destroy();
```

### 状态机

AgentSession 内部维护 5 个状态的有限状态机：

```
idle → thinking → running → completed
                  ↘         ↗
                   error → idle
```

- `idle`: 初始/销毁后状态
- `thinking`: 接收消息，准备 LLM 调用
- `running`: 执行对话循环（可能触发工具调用）
- `completed`: 对话正常结束
- `error`: 发生错误

### 子代理体系

- 父 Agent 通过 `spawnSubagent()` 创建子 AgentSession
- 递归深度受 `maxSpawnDepth` 限制（默认 3）
- 不允许 spawn 同类型子代理
- 子代理完成后结果注入父代理续接

### 工具拦截

- `sessionToolContext.ts` 构造 `toolInterceptor`，拦截 builtin 工具
- `spawnToolSubagent` 由 ToolContext 调用，注册到 tracker 后异步执行

### 消息序列化

- `MessageSerializer` 支持 JSON 序列化 + SHA-256 校验和
- 版本迁移机制：旧版本消息自动升级
- 工厂函数：`createRequest`、`createResponse`、`createError`、`createHeartbeat`

## 依赖注入

`sessionDeps.ts` 提供依赖注入单例，生产代码使用只读 getter 视图：

```typescript
// 生产代码 — 只读
import { agentSessionDeps } from "./sessionDeps";
const handler = new agentSessionDeps.ConversationHandler(config, opts);

// 测试代码 — 可替换
import { __setAgentSessionDepsForTesting } from "./sessionDeps";
__setAgentSessionDepsForTesting({ ConversationHandler: mockHandler });
// ... 测试 ...
__resetAgentSessionDepsForTesting();
```

## 设计决策

| 决策                           | 选择                 | 理由                                               |
| ------------------------------ | -------------------- | -------------------------------------------------- |
| `sessionDeps` 使用 `require()` | CJS require() 懒加载 | 循环依赖 TDZ workaround，避免 ESM 静态分析时序问题 |
| 状态转移拒绝非法路径           | throw Error          | 防止状态机进入不可预期状态                         |
| `hookManager` 全局单例         | `lifecycleHooks`     | 跨模块钩子注册便利性，接受全局状态的 trade-off     |
| 子代理深度限制                 | 默认 3 层            | 防止 LLM 通过工具无限递归                          |
| 校验和算法                     | SHA-256 前 16 hex    | 兼顾存储开销与碰撞抗性                             |

## 外部依赖

- `@/agent/core/manager` — Agent 注册/状态管理
- `@/conversation` — ConversationHandler（对话循环引擎）
- `@/agent/subagent/tracker` — 子代理运行时追踪
- `@/agent/subagent/toolInterceptor` — builtin 工具拦截
- `@/tool/executor/runtimeExec` — 基础 ToolContext 构造
- `@/core/errors/appError` — 统一错误工厂
