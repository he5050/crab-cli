# Command 模块 — CLI 配置命令实现层

## 整体定位

Command 模块是 `crab-cli` 的命令实现层，负责实现 `crab` CLI 工具中**配置管理**相关的全部子命令。它不包含命令路由逻辑（路由在 `@cli/core/orchestrator`），仅提供命令的具体业务实现。各命令通过动态 `import()` 按需加载，启动时无额外开销。

当前涵盖 4 个命令：

- **config setup** — 交互式配置向导（Provider 选择、API Key 输入、模型配置）
- **config test** — 验证 Provider 连接可用性（延迟测试、健康状态输出）
- **config export** — 导出配置为 JSON（支持脱敏、美化输出、文件/stdout）
- **config import** — 从 JSON 文件导入配置（支持合并/覆盖模式、格式验证）

## 核心功能

1. **交互式配置** — 基于 `readline/promises` 的引导式配置流程，支持 Provider 选择、API Key 格式校验、模型配置
2. **配置导入** — 从 JSON 文件读取 → Zod 验证 → 合并/覆盖 → 持久化到配置文件
3. **配置导出** — 加载当前配置 → 可选脱敏（递归移除敏感字段）→ JSON 序列化输出到文件或 stdout
4. **连接测试** — 单/全量 Provider 测试，输出健康状态 + 延迟信息 + 故障排查建议

## 目录结构

```
src/command/
├── index.ts              # 值导出入口（@command），所有命令函数的统一引用入口
├── type.ts               # 类型导出入口（@command/type），所有命令类型定义
├── README.md             # 本文档
│
└── config/               # 配置管理命令子模块
    ├── index.ts           # Config 子模块统一出入口
    ├── setup.ts           # 交互式配置向导
    ├── import.ts          # 配置导入（JSON → 配置文件）
    ├── export.ts          # 配置导出（配置文件 → JSON）
    └── test.ts            # Provider 连接测试
```

## 子模块说明

| 子模块             | 职责                    | 主要导出                                                                          |
| ------------------ | ----------------------- | --------------------------------------------------------------------------------- |
| `type.ts`          | 类型定义统一导出入口    | `ImportOptions`, `ExportOptions`, `TestResult`                                    |
| `config/index.ts`  | Config 子模块统一出入口 | `setupCommand`, `configImportCommand`, `configExportCommand`, `configTestCommand` |
| `config/setup.ts`  | 交互式配置向导          | `setupCommand`                                                                    |
| `config/import.ts` | 配置导入命令            | `configImportCommand`                                                             |
| `config/export.ts` | 配置导出命令            | `configExportCommand`                                                             |
| `config/test.ts`   | Provider 连接测试       | `configTestCommand`                                                               |

## 完整 API 导出

CLI 模块提供两个出入口文件：`index.ts`（值导出）和 `type.ts`（类型导出）。

### 类型导出（@command/type）

```typescript
import type {
  ImportOptions, // 配置导入选项（force / merge）
  ExportOptions, // 配置导出选项（output / sanitize / format）
  TestResult, // Provider 测试结果
  ProviderOption, // setup 命令中的 Provider 选项描述
} from "@command/type";
```

### 值导出（@command）

```typescript
import {
  setupCommand, // 交互式配置向导
  configImportCommand, // 从 JSON 文件导入配置
  configExportCommand, // 导出配置为 JSON
  configTestCommand, // 测试 Provider 连接可用性
} from "@command";
```

## 使用方法

### 调用方式

Command 模块的命令由 CLI 编排器路由调用，外部模块通常不直接引用。路由逻辑位于 `@cli/core/orchestrator`，采用动态 `import()` 按需加载：

```typescript
// orchestrator.ts 中的命令路由（内部实现，仅供理解）
switch (mode) {
  case "setup":
    const { setupCommand } = await import("@command/config/setup");
    await setupCommand();
    break;
  case "config-test":
    const { configTestCommand } = await import("@command/config/test");
    await configTestCommand(providerId);
    break;
  case "config-export":
    const { configExportCommand } = await import("@command/config/export");
    await configExportCommand(options);
    break;
  case "config-import":
    const { configImportCommand } = await import("@command/config/import");
    await configImportCommand(inputPath, options);
    break;
}
```

### 直接调用（高级场景）

```typescript
import { setupCommand, configTestCommand, configExportCommand, configImportCommand } from "@command";
import type { ImportOptions, ExportOptions } from "@command/type";

// 交互式配置
await setupCommand();

// 测试所有 Provider
await configTestCommand();

// 测试单个 Provider
await configTestCommand("openai");

// 导出脱敏配置到文件
await configExportCommand({ output: "./config-backup.json", sanitize: true });

// 从 JSON 文件导入配置（合并模式）
await configImportCommand("./config.json", { merge: true });

// 从 JSON 文件导入配置（覆盖模式）
await configImportCommand("./config.json", { force: true, merge: false });
```

## 在系统架构中的作用

```
用户执行 crab config test
       │
       ▼
┌──────────────────────────────────────────┐
│         CLI 编排器 (@cli/core)            │
│         parseCliArgs() → executeMode()      │
│                    │                       │
│          动态 import() 按需加载              │
│                    │                       │
└────────────┼──────────────────────────────┘
             │
┌────────────▼──────────────────────────────┐
│       Command 模块 (@command)               │
│  ┌─────────────────────────────────────┐   │
│  │ config/setup  — 交互式配置向导        │   │
│  │ config/test   — Provider 连接测试     │   │
│  │ config/export — 配置导出为 JSON       │   │
│  │ config/import — 从 JSON 导入配置      │   │
│  └─────────────────────────────────────┘   │
│                                              │
└──────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────┐
│  @config │ @schema │ @api │ @cli        │
│  (加载)   (验证)   (健康检查) (错误输出)  │
└──────────────────────────────────────────┘
```

## 与外部系统的交互

| 外部模块                 | 交互方式        | 说明                                                                |
| ------------------------ | --------------- | ------------------------------------------------------------------- |
| `@cli/core/orchestrator` | 动态 `import()` | 命令路由与按需加载调用                                              |
| `@config`                | 依赖            | `loadConfig()` / `saveConfig()` / `getGlobalConfigPath()` 读写配置  |
| `@schema/config`         | 依赖            | `AppConfigSchema.parse()` 验证配置格式，`SingleProviderConfig` 类型 |
| `@api`                   | 依赖            | `checkProviderHealth()` / `checkAllProvidersHealth()` 连接测试      |
| `@cli`                   | 依赖            | `createCliError()` / `writeCliError()` CLI 错误输出                 |

## 各命令详细说明

### setup — 交互式配置向导

**流程：**

1. 检测已有配置，确认是否覆盖
2. Provider 选择（OpenAI / Anthropic / Google / Custom）
3. API Key 输入 + 格式校验（各 Provider 有不同前缀规则）
4. 模型名称配置
5. 配置验证 + 持久化

**Provider 支持：**

| Provider         | 默认模型                 | API Key 前缀 | 请求方法 |
| ---------------- | ------------------------ | ------------ | -------- |
| OpenAI           | gpt-4o                   | `sk-...`     | `chat`   |
| Anthropic Claude | claude-sonnet-4-20250514 | `sk-ant-...` | `claude` |
| Google Gemini    | gemini-2.5-pro           | `AIza...`    | `gemini` |
| Custom           | gpt-4o                   | 自定义       | `chat`   |

### test — Provider 连接测试

**输出格式：**

```
  ✓ openai (142ms) - 连接正常
  ✗ anthropic (5032ms) - 连接被拒绝
```

**诊断建议：**

- 未配置 API Key → `crab setup` 或手动配置 `apiKey`
- 有 baseURL → 检查 Base URL 是否正确
- 连接被拒绝 → 检查网络连接

### export — 配置导出

**脱敏规则：** 递归移除字段名中包含 `key` / `secret` / `token` / `password` 的字段，值替换为 `***REDACTED***`

> **已知限制：** 脱敏基于字段名子串匹配，理论上含上述关键词的非敏感字段（如 `keyboardShortcut`）会被误脱敏。当前 `AppConfigSchema` 中不存在此类字段，未来扩展时需注意。

**输出模式：**

- `pretty`（默认）— 缩进 2 空格美化 JSON
- `json` — 紧凑 JSON，适合程序消费

### import — 配置导入

**导入流程：** JSON 文件 → `JSON.parse()` → `AppConfigSchema.parse()` → 合并/覆盖 → `saveConfig()`

**合并模式：** `deepMerge` 深度合并，新配置优先覆盖旧配置
**覆盖模式：** `force=true` 跳过确认，`force=false` 显示确认提示

## 设计决策

| 决策                     | 原因                                                          |
| ------------------------ | ------------------------------------------------------------- |
| 动态 `import()` 加载     | 命令模块不需要启动时加载，按需加载减少启动时间                |
| `@command` 路径别名      | 与 `@cli`、`@bus`、`@compress` 等保持一致的模块别名规范       |
| 双出入口（index + type） | 值/类型分离，改善 tree-shaking，类型无需加载运行时代码        |
| Zod 验证                 | 配置导入时通过 `AppConfigSchema.parse()` 校验，确保数据一致性 |
| 敏感字段脱敏             | 导出时递归移除敏感字段，防泄漏但不修改源数据                  |
| config/ 子目录           | 按业务域划分，4 个配置命令归类在 config 子模块中，职责清晰    |

## 错误处理

所有命令使用 `@cli/errors` 的统一错误处理：

```typescript
writeCliError(
  createCliError({
    kind: "resource-not-found",
    message: "配置文件不存在: /path/to/config.json",
    context: { inputPath: "/path/to/config.json" },
  }),
);
process.exit(1);
```

**错误类型映射：**

| 错误类型   | kind                 | 触发场景                        |
| ---------- | -------------------- | ------------------------------- |
| 资源不存在 | `resource-not-found` | 配置文件不存在、Provider 未配置 |
| 参数无效   | `invalid-parameter`  | JSON 格式错误、Schema 验证失败  |
| 写入失败   | `write-failed`       | 配置保存失败、目录创建失败      |

## 边界与限制

1. **仅覆盖配置命令** — 当前只有 `config/*` 4 个命令，其他 CLI 功能（TUI、无头、SSE 等）在各自模块中
2. **进程退出** — 错误场景直接 `process.exit(1)`，不做优雅恢复
3. **导入使用 Node fs** — 未使用 Bun 专有 API，保持跨运行时兼容
4. **setup 使用同步 readline** — `readline/promises` 的 `createInterface` 会阻塞 stdin，仅用于交互式流程

## 故障排查

| 现象                 | 可能原因                   | 排查步骤                            |
| -------------------- | -------------------------- | ----------------------------------- |
| API Key 格式校验失败 | Key 前缀与 Provider 不匹配 | 检查 API Key 是否以正确前缀开头     |
| 配置格式验证失败     | JSON 结构不符合 Schema     | 检查 JSON 是否匹配 AppConfigSchema  |
| Provider 连接超时    | 网络不通或 API Key 无效    | 检查 baseURL 是否正确，网络是否通畅 |
| 配置保存失败         | 文件权限或磁盘空间不足     | 检查配置目录权限，确认磁盘空间      |

## 相关测试

| 测试文件                                       | 覆盖范围                                                         |
| ---------------------------------------------- | ---------------------------------------------------------------- |
| `test/unit/command/configExport.test.ts`       | 导出 stdout、导出文件、脱敏处理、嵌套目录创建                    |
| `test/unit/command/configImport.test.ts`       | 文件不存在、无效 JSON、合并模式、覆盖模式                        |
| `test/unit/command/configTest.test.ts`         | Provider 不存在时的错误处理                                      |
| `test/unit/command/configTestExtended.test.ts` | 单 Provider 成功/全量成功（mock 集成测试）                       |
| `test/unit/command/setup.test.ts`              | API Key 格式校验（5 Provider）、选项编号校验、PROVIDERS 常量结构 |
| `test/integration/configRoundtrip.test.ts`     | 导出→导入往返数据一致性（集成测试）                              |
