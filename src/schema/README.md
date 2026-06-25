# Schema 模块

> 统一 Zod Schema 定义层 — 应用所有数据结构的运行时验证入口。

## 职责

- 为配置文件（`~/.crab/config.json`）、MCP 配置、Agent 定义等提供运行时类型验证
- 定义品牌化 ID 格式（ULID + 前缀）确保 ID 类型安全
- 统一导出入口（`index.ts`），外部模块应通过 `@/schema` 导入

## 边界

- **仅包含 Schema 定义**，不包含业务逻辑或数据持久化
- 使用 Zod 4 进行运行时类型验证
- Schema 变更需要同步更新推断类型

## 文件结构

```
schema/
├── index.ts          # 统一入口，导出所有 Schema 及推断类型
├── config.ts         # 应用主配置（AppConfigSchema）及 MCP/Proxy/Provider 子 Schema
├── agent.ts          # Agent 模式、模型、定义 Schema
├── permission.ts     # 权限动作、规则、规则集、决策结果 Schema
├── session.ts        # 消息角色、部分类型、消息、会话 Schema（引用 ids.ts）
├── tool.ts           # 工具参数（递归 JSON Schema）、定义、调用、结果 Schema（引用 ids.ts）
├── ids.ts            # 品牌化 ID Schema（SessionID/MessageID/PartID/ToolCallID）
└── api.ts            # API Provider 枚举（其余 Schema 已废弃，项目依赖 AI SDK）
```

## 命名规范

| 导出类型               | 命名      | 示例                                  |
| ---------------------- | --------- | ------------------------------------- |
| Zod Schema（运行时值） | 原名      | `AppConfigSchema`, `PermissionRule`   |
| 推断 TypeScript 类型   | `XxxType` | `AppConfigType`, `PermissionRuleType` |

## 依赖关系

```
config.ts → agent.ts → permission.ts
config.ts → permission.ts          (permissions 字段)
session.ts → ids.ts                (SessionID, MessageID, ToolCallID)
tool.ts    → ids.ts                (ToolCallID)
```

无循环依赖。`ids.ts` 是叶子节点，被 `session.ts` 和 `tool.ts` 引用。

## 使用示例

```typescript
import { AppConfigSchema } from "@/schema";
import type { AppConfigType } from "@/schema";

// 验证配置文件
const result = AppConfigSchema.safeParse(rawConfig);
if (!result.success) {
  // 处理验证错误
}

// 类型安全访问
const config: AppConfigType = AppConfigSchema.parse(rawConfig);
```

## 与其他模块的关系

| 外部模块          | 引用的 Schema                             | 用途             |
| ----------------- | ----------------------------------------- | ---------------- |
| `src/config/`     | `AppConfigSchema`, `SingleProviderConfig` | 配置加载与验证   |
| `src/mcp/`        | `McpServerConfig`, `McpConfigFileSchema`  | MCP 配置验证     |
| `src/agent/`      | `AgentMode`, `PermissionRuleset`          | Agent 注册与权限 |
| `src/api/`        | `RequestMethod`, `ThinkingConfig`         | LLM 请求构建     |
| `src/permission/` | `PermissionRule`, `PermissionAction`      | 权限评估         |

## 注意事项

- `api.ts` 中的 `ApiConfig`、`AiMessage`、`ApiRequest`、`ApiResponse` 已于 v0.2 移除，新代码应直接使用 Vercel AI SDK 的原生类型
- `agentDefinitions.ts` 中的 `AgentDefinition`（interface，18+ 字段）与 `schema/agent.ts` 中的 `AgentDefinition`（Zod schema，7 字段）是**有意为之的两套设计**：前者用于内置 Agent 运行时定义，后者用于用户配置文件验证
- `agentDefinitions.ts` 的 `AgentMode` 含 `"hidden"` 值（内部定义用），运行时通过 `resolveAgentMode()` 映射为 `"subagent"`
