# Permission Module — 权限管理与安全检查

## 整体定位

Permission 模块是系统的安全守门人，负责工具调用前的权限评估、审批管理、敏感命令检测和跨进程权限桥接。它为 CLI 提供全维度的权限控制能力，确保所有敏感操作都经过适当的授权和检查。

## 核心功能

1. **权限规则评估** — 基于通配符匹配的权限规则评估引擎，支持 allow/deny/ask 三种动作
2. **权限管理器** — 管理会话级和持久化审批规则，处理用户审批交互
3. **敏感命令检测** — 检测危险命令（rm -rf /）、自毁命令（killall node）和 40+ 预设敏感命令
4. **审批持久化** — 使用 SQLite 存储审批结果，支持会话级和永久授权
5. **跨进程桥接** — 通过文件系统实现主进程与子进程/Worker 的权限审批通信
6. **UI 状态管理** — 管理权限弹窗的激活状态，协调键盘焦点释放

## 目录结构

```
src/permission/
├── index.ts                # 统一出入口（值导出 + 类型重导出）
├── types.ts                # 统一类型导出
├── README.md               # 本文档
│
├── core/                   # 核心评估引擎
│   ├── wildcard.ts        # 通配符匹配引擎（支持 * ** ? [abc] [a-z]，递归深度限制防栈溢出）
│   ├── evaluate.ts        # 权限规则评估器（allow/deny/ask）
│   └── normalize.ts        # 审批动作归一化（ApprovalAction | boolean → ApprovalAction）
│
├── manager/                # 权限管理器
│   └── permission.ts      # PermissionManager 类（审批状态管理 + 用户交互 + 生命周期保护）
│
├── store/                  # 数据存储与桥接
│   ├── approvalStore.ts    # 审批结果持久化（SQLite CRUD）
│   └── approvalBridge.ts  # 跨进程权限桥接（文件系统通信）
│
├── security/               # 安全检查
│   ├── dangerDetector.ts       # 危险命令 + 自毁命令检测 + 输出截断
│   ├── sensitiveCommand.ts     # 统一重导出层（向后兼容）
│   ├── sensitiveCommandStore.ts # 敏感命令 CRUD + 配置读写 + 预设列表
│   ├── sensitiveCommandMatcher.ts # 敏感命令模式匹配（ReDoS 防护）
│   └── riskPatterns.ts         # 共享风险模式（高/中风险命令分类）
│
└── ui/                     # UI 状态
    └── permissionState.ts  # 权限弹窗激活状态（Solid.js 信号）
```

## 子模块说明

| 子模块      | 职责                               | 主要导出                                                                                                                       |
| ----------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `core/`     | 通配符匹配 + 规则评估 + 审批归一化 | `wildcardMatch`, `evaluate`, `evaluateBatch`, `normalizeApprovalAction`                                                        |
| `manager/`  | 权限管理器                         | `PermissionManager`, `PermissionAskInput`, `ApprovalAction`                                                                    |
| `store/`    | 审批持久化 + 跨进程桥接            | `saveApproval`, `getApproval`, `clearAllApprovals`, `listPendingExternalPermissionRequests`, `submitExternalPermissionRequest` |
| `security/` | 安全检查（拆分为 4 个子模块）      | `isDangerousCommand`, `isSelfDestructiveCommand`, `isSensitiveCommand`, `PRESET_SENSITIVE_COMMANDS`, `classifyRiskLevel`       |
| `ui/`       | 弹窗激活状态                       | `permissionActive`, `setPermissionActive`, `buildPermissionRequestSnapshot`                                                    |

## 完整 API 导出

### 类型导出

```typescript
import type {
  // Core
  EvaluateResult, // 评估结果（rule + action）

  // Manager
  PermissionAskInput, // 权限请求输入
  ApprovalAction, // 审批动作："once" | "always" | "reject"

  // Store
  ApprovalRecord, // 审批记录
  ExternalPermissionRequest, // 外部权限请求
  RemotePermissionResolveResult, // 远程权限解析结果

  // Security
  SensitiveCommand, // 敏感命令定义
  SensitiveCommandScope, // 作用域："global" | "project"
  SensitiveCommandsConfig, // 敏感命令配置
  SelfDestructiveResult, // 自毁命令检测结果
  SensitiveCheckResult, // 敏感命令检查结果
  SensitiveCommandResult, // 向后兼容的检查结果

  // UI
  PermissionRiskLevel, // 风险级别："low" | "medium" | "high"
  PermissionRequestSnapshot, // 权限请求快照
  PermissionBlockedFeedbackModel, // 阻止反馈模型
} from "@permission";
```

### 值导出

```typescript
import {
  // ─── Core: Wildcard ──────────────────────────────────────
  wildcardMatch, // 通配符匹配函数

  // ─── Core: Evaluate ──────────────────────────────────────
  evaluate, // 评估单条权限
  evaluateBatch, // 批量评估多条模式

  // ─── Manager ─────────────────────────────────────────────
  PermissionManager, // 权限管理器类

  // ─── Store: ApprovalStore ────────────────────────────────
  saveApproval, // 保存审批记录
  getApproval, // 获取审批记录
  deleteApproval, // 删除审批记录
  getAllApprovals, // 获取所有审批记录
  cleanExpired, // 清理过期审批记录

  // ─── Store: ApprovalBridge ───────────────────────────────
  listPendingExternalPermissionRequests, // 列出待处理的外部请求
  resolveExternalPermissionRequest, // 解析外部权限请求
  resolveExternalPermissionRequestForSession, // 按会话解析
  submitExternalPermissionRequest, // 提交外部权限请求并等待结果

  // ─── Security ────────────────────────────────────────────
  isDangerousCommand, // 检查危险命令
  isSelfDestructiveCommand, // 检查自毁命令
  truncateOutput, // 截断超长输出
  PRESET_SENSITIVE_COMMANDS, // 预设敏感命令列表
  loadSensitiveCommands, // 加载敏感命令配置
  saveSensitiveCommands, // 保存敏感命令配置
  getAllSensitiveCommands, // 获取所有敏感命令
  addSensitiveCommand, // 添加自定义敏感命令
  removeSensitiveCommand, // 删除敏感命令
  toggleSensitiveCommand, // 切换敏感命令启用/禁用
  resetSensitiveCommands, // 重置为默认预设
  isSensitiveCommand, // 检查命令是否匹配敏感模式
  checkSensitiveCommand, // 完整的敏感命令检查（向后兼容）

  // ─── UI ──────────────────────────────────────────────────
  permissionActive, // 权限弹窗激活状态信号
  currentPermissionRequest, // 当前权限请求快照信号
  setPermissionActive, // 设置权限弹窗激活状态
  setCurrentPermissionRequest, // 设置当前权限请求快照
  buildPermissionRequestSnapshot, // 构建权限请求快照
  buildPermissionBlockedFeedback, // 构建阻止反馈
} from "@permission";
```

## 使用方法

### 权限规则评估

```typescript
import { evaluate, evaluateBatch, wildcardMatch } from "@permission";

// 通配符匹配
wildcardMatch("*.ts", "src/foo.ts"); // true
wildcardMatch("src/**", "src/a/b.ts"); // true
wildcardMatch("git *", "git status"); // true

// 单条评估
const ruleset: PermissionRuleset = [
  { action: "allow", permission: "fs.read", pattern: "**" },
  { action: "deny", permission: "bash", pattern: "sudo *" },
];
const result = evaluate("bash", "rm -rf node_modules", ruleset);
// → { action: "ask", rule: null }（无匹配，默认 ask）

// 批量评估
const batchResult = evaluateBatch("bash", ["ls", "rm -rf /"], ruleset);
// → 只要有一个模式被 deny，则整体 deny
```

### 权限管理器

```typescript
import { PermissionManager } from "@permission";

const manager = new PermissionManager(defaultRules, sessionId);

// 请求权限
const allowed = await manager.ask({
  permission: "bash",
  patterns: ["rm -rf node_modules"],
  tool: "bash",
  sessionId: "session-123",
  description: "删除 node_modules 目录",
});

// 用户回复（通过事件总线）
manager.reply(requestId, "once"); // 允许一次
manager.reply(requestId, "always"); // 始终允许
manager.reply(requestId, "reject"); // 拒绝

// 手动批准/拒绝
manager.approve("bash", "ls *", true); // 持久化批准
manager.deny("bash", "sudo *"); // 拒绝

// 获取状态
const approved = manager.getApprovedRules();
const pending = manager.getPendingRequests();

// 清理
manager.clearSession(); // 清除会话级规则
manager.destroy(); // 销毁管理器
```

### preCheck vs ask 的区别

| 特性           | `preCheck()`                | `ask()`                             |
| -------------- | --------------------------- | ----------------------------------- |
| 触发用户审批   | ❌ 不触发                   | ✅ 需要时触发                       |
| 检查持久化审批 | ❌ 不检查                   | ✅ 检查                             |
| 检查会话级规则 | ✅ 检查                     | ✅ 检查                             |
| 默认规则评估   | 逐 pattern 独立             | 跨 pattern（任一 deny → 整体 deny） |
| 返回值         | 每个 pattern 的评估结果数组 | 整体布尔值                          |
| 适用场景       | UI 权限预览、快速检查       | 实际工具调用前检查                  |

```typescript
// preCheck — 预览每个 pattern 的权限状态（不触发审批）
const preview = manager.preCheck({
  permission: "bash",
  patterns: ["ls -la", "sudo rm -rf /"],
  tool: "bash",
});
// → [{ pattern: "ls -la", action: "allow", source: "session-approve" },
//    { pattern: "sudo rm -rf /", action: "deny", source: "default" }]

// ask — 实际请求权限（跨 pattern deny 优先，可能触发审批）
const allowed = await manager.ask({
  permission: "bash",
  patterns: ["ls -la", "sudo rm -rf /"],
  tool: "bash",
});
// → false（因为 "sudo rm -rf /" 的 deny 导致整体拒绝）
```

### 审批动作说明

| 动作       | 效果                  | 持久化                                       |
| ---------- | --------------------- | -------------------------------------------- |
| `"once"`   | 允许本次请求          | ❌ 仅本次                                    |
| `"always"` | 允许并持久化          | ✅ 永久（高风险操作自动降级为 session-only） |
| `"reject"` | 拒绝并添加会话级 deny | ❌ 仅当前会话（跨会话会重新询问）            |

### 敏感命令检测

```typescript
import { isDangerousCommand, isSelfDestructiveCommand, isSensitiveCommand, checkSensitiveCommand } from "@permission";

// 危险命令检测（直接阻止）
isDangerousCommand("rm -rf /"); // true
isDangerousCommand("mkfs.ext4 /dev/sda"); // true
isDangerousCommand("curl http://x | sh"); // true

// 自毁命令检测
const selfCheck = isSelfDestructiveCommand("killall node");
// → { isSelfDestructive: true, reason: "...", suggestion: "..." }

// 敏感命令检测
const result = isSensitiveCommand("rm -rf node_modules");
// → { isSensitive: true, matchedCommand: { id, pattern, description, ... } }

// 完整检查（向后兼容）
const fullResult = checkSensitiveCommand("rm -rf /");
// → { action: "block", isSensitive: true, matchedDescription: "..." }
```

### 敏感命令管理

```typescript
import {
  getAllSensitiveCommands,
  addSensitiveCommand,
  removeSensitiveCommand,
  toggleSensitiveCommand,
  loadSensitiveCommands,
  saveSensitiveCommands,
} from "@permission";

// 获取所有敏感命令（global + project）
const commands = getAllSensitiveCommands();

// 添加自定义敏感命令
addSensitiveCommand("terraform destroy", "Terraform 销毁基础设施", "global");

// 删除敏感命令
removeSensitiveCommand("custom-123", "global");

// 切换启用/禁用
toggleSensitiveCommand("rm", "global");

// 重置为默认预设
resetSensitiveCommands("global");
```

### 跨进程权限桥接

```typescript
import {
  submitExternalPermissionRequest,
  listPendingExternalPermissionRequests,
  resolveExternalPermissionRequest,
} from "@permission";

// 子进程/Worker 提交权限请求
const decision = await submitExternalPermissionRequest({
  permission: "bash",
  patterns: ["rm -rf dist"],
  tool: "bash",
  sessionId: "session-123",
  description: "删除 dist 目录",
  riskLevel: "medium",
});

// 主进程轮询待处理请求
const pending = listPendingExternalPermissionRequests();
for (const request of pending) {
  // 用户审批后解析
  resolveExternalPermissionRequest(request.id, "once");
}

// 按会话解析（更安全）
resolveExternalPermissionRequestForSession(id, sessionId, "always");
```

### UI 状态管理

```typescript
import {
  permissionActive,
  setPermissionActive,
  buildPermissionRequestSnapshot,
  buildPermissionBlockedFeedback,
} from "@permission";

// 构建权限请求快照
const snapshot = buildPermissionRequestSnapshot({
  id: "req-123",
  permission: "bash",
  tool: "bash",
  patterns: ["rm -rf node_modules"],
  description: "删除 node_modules",
  riskLevel: "high",
});

// 设置激活状态
setPermissionActive(true);
setCurrentPermissionRequest(snapshot);

// 构建阻止反馈
const feedback = buildPermissionBlockedFeedback(snapshot);
// → { message, toolLine, riskLine, commandLine, descriptionLine, shortcutHint }

// 监听状态（在 Solid.js 组件中）
createEffect(() => {
  if (permissionActive()) {
    // 释放键盘焦点
  }
});
```

## 配置项

### 敏感命令预设

系统预设了 40+ 敏感命令，涵盖以下类别：

| 类别         | 示例                                   | 默认启用 |
| ------------ | -------------------------------------- | -------- |
| 文件删除     | `rm`, `rmdir`, `unlink`                | ✅       |
| 权限修改     | `chmod`, `chown`                       | ❌       |
| 磁盘操作     | `dd`, `mkfs`, `fdisk`                  | ✅       |
| 进程管理     | `killall`, `pkill`                     | ❌       |
| 系统操作     | `reboot`, `shutdown`                   | ✅       |
| 提权操作     | `sudo`, `su`                           | ❌       |
| Git 危险操作 | `git push --force`, `git reset --hard` | ✅       |
| Docker       | `docker rm`, `docker rmi`              | ❌       |
| 数据库       | `mysql`, `psql`, `sqlite3`             | ❌       |
| SQL 危险语句 | `DROP TABLE`, `DELETE FROM`            | ✅       |

### 风险级别

| 级别     | 触发条件                                        | 限制                   |
| -------- | ----------------------------------------------- | ---------------------- |
| `high`   | 匹配高风险模式（rm -rf /、sudo、curl \| sh 等） | 禁止 "always" 永久授权 |
| `medium` | 匹配中风险模式（rm -r、chmod、git reset 等）    | 允许 "always"          |
| `low`    | 其他操作                                        | 允许 "always"          |

## 与外部系统的交互

| 外部模块                      | 交互方式          | 说明                                                                                   |
| ----------------------------- | ----------------- | -------------------------------------------------------------------------------------- |
| `@schema/permission`          | 读取权限规则类型  | `PermissionRule`, `PermissionRuleset`, `PermissionAction`                              |
| `@bus/eventBus`               | 发布/订阅权限事件 | `AppEvent.PermissionAsked`, `AppEvent.PermissionResolved`, `AppEvent.PermissionStatus` |
| `@db`                         | 持久化审批记录    | SQLite 存储审批历史                                                                    |
| `@core/logging/logger`        | 日志输出          | 权限评估、审批、敏感命令检测的日志                                                     |
| `@core/errors/appError`       | 错误创建          | 敏感命令配置错误的结构化错误                                                           |
| `@config`                     | 读取配置          | 数据目录、全局配置目录路径                                                             |
| `@security/audit/auditLogger` | 审计日志          | 权限评估的授权决策审计                                                                 |

## 边界与限制

1. **通配符匹配限制** — 支持 `*` `**` `?` `[abc]` `[a-z]`，但不支持嵌套括号和复杂正则
2. **敏感命令模式限制** — 最多 3 个通配符，模式长度不超过 200 字符，防止 ReDoS 攻击
3. **跨进程桥接超时** — 默认 1 小时超时，超时后自动拒绝
4. **跨进程桥接轮询** — 500ms 轮询间隔，平衡响应速度和 CPU 开销
5. **持久化审批隔离** — 支持会话级隔离，不同会话的审批记录互不影响
6. **高风险操作保护** — 风险级别为 `high` 时禁止 "always" 永久授权
7. **自毁命令检测** — 仅检测常见自毁模式，不保证覆盖所有情况
8. **持久化审批精确匹配** — `getApproval()` 使用精确字符串匹配（permission + pattern），不支持通配符匹配。例如批准 `"npm *"` 后，查询 `"npm install"` 不会命中。`approve()` 保存的 pattern 必须与后续 `ask()` 的 pattern 完全一致

## 权限决策流程

```
┌──────────────────────────────────────────────────────────────────┐
│                    工具调用触发权限检查                           │
└──────────────────────┬───────────────────────────────────────────┘
                       ▼
              ┌────────────────┐
              │  preCheck()    │ ← 可选: UI 预览，不触发审批
              │  (仅会话级)    │
              └───────┬────────┘
                      ▼
              ┌────────────────┐     ┌─────────────────┐
              │    ask()      │────►│ checkSensitive  │ → block（危险命令）
              │               │     │    Command()    │ → confirm（敏感命令）
              └───────┬────────┘     └─────────────────┘
                      ▼
              ┌────────────────┐
              │ 0. 持久化审批  │ ← SQLite 查询 (精确匹配)
              │    deny → false│
              │    allow → 缓存│
              └───────┬────────┘
                      ▼
              ┌────────────────┐
              │ 1. 会话级 deny  │ ← evaluate(denied rules)
              │    → false     │
              └───────┬────────┘
                      ▼
              ┌────────────────┐
              │ 2. 会话级 allow│ ← evaluate(approved rules)
              │    → true      │
              └───────┬────────┘
                      ▼
              ┌────────────────────────┐
              │ 3. 默认规则评估      │ ← evaluate(defaultRules)
              │    deny → false       │    deny > ask > allow
              │    allow → true       │    (跨 pattern 优先级)
              │    ask → 继续         │
              └───────┬───────────────┘
                      ▼
         ┌────────────────────────┼──────────────────────────┐
         │ 有 requestApprovalHandler?│       无 handler       │
         ▼                         ▼                         │
   ┌─────────────┐        ┌──────────────────┐               │
   │ handler()   │        │ EventBus 发布    │               │
   │ → 降级检查  │        │ PermissionAsked  │ → UI 弹窗     │
   │ → 持久化    │        └───────┬──────────┘               │
   └──────┬──────┘                ▼                        │
          │               ┌──────────────────┐               │
          ▼               │ 用户审批回复     │               │
   ┌─────────────┐        │ PermissionResolved│               │
   │ always →    │        └───────┬──────────┘               │
   │   持久化允许 │               ▼                        │
   │ once → 允许  │        ┌──────────────────┐               │
   │ reject →     │        │ reply()          │               │
   │   会话级拒绝 │        │ always → 持久化  │               │
   └──────┬──────┘        │ once → 一次允许  │               │
          │               │ reject → 会话拒绝 │               │
          ▼               └──────────────────┘               │
   ┌─────────────┐                                           │
   │ 高风险防护    │  "always" 被降级为 "session-only"         │
   │ always → once│  + EventBus.PermissionStatus 通知 UI      │
   └──────┬──────┘                                           │
          │                                                     │
          ▼                                                     │
   ┌─────────────┐     ┌──────────────────┐                     │
   │ SQLite 持久化 │     │ EventBus 发布    │                     │
   │ (allow/deny) │     │ PermissionStatus  │ → UI 状态更新    │
   └─────────────┘     └──────────────────┘                     │
```

## 设计决策

| 决策                                       | 原因                                 |
| ------------------------------------------ | ------------------------------------ |
| 通配符匹配使用递归算法而非正则转换         | 避免 ReDoS，支持复杂模式，性能可控   |
| 敏感命令配置支持 global + project 双作用域 | 用户可在全局和项目中分别管理敏感命令 |
| 跨进程桥接使用文件系统而非 socket          | 无需额外端口，跨平台兼容，易于调试   |
| 审批记录使用 SQLite 而非 JSON 文件         | 支持高效查询、过期清理、事务安全     |
| 风险级别计算基于模式匹配而非 AI            | 零延迟、可预测、无额外依赖           |
| UI 状态使用 Solid.js 信号                  | 响应式更新，与现有 UI 架构一致       |

## 故障排查

| 现象                 | 可能原因                         | 排查步骤                                                  |
| -------------------- | -------------------------------- | --------------------------------------------------------- |
| 权限评估始终返回 ask | 规则集为空或模式不匹配           | 检查 `ruleset` 内容和 `wildcardMatch` 返回值              |
| 敏感命令检测不生效   | 命令未启用或模式不匹配           | 调用 `getAllSensitiveCommands()` 检查启用状态             |
| 跨进程桥接超时       | 主进程未处理请求或文件锁竞争     | 检查 `listPendingExternalPermissionRequests()` 是否有请求 |
| 权限弹窗不显示       | `permissionActive` 未设置为 true | 检查 `setPermissionActive(true)` 是否调用                 |
| 持久化审批不生效     | SQLite 写入失败或会话 ID 不匹配  | 检查 `getAllApprovals()` 是否有记录                       |
| 危险命令误判         | 命令包含危险子串                 | 检查 `DANGEROUS_PATTERNS` 正则是否过于宽泛                |
