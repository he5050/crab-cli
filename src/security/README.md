# Security 模块

> crab-cli 安全能力层 — 提供剪贴板消毒、重放攻击防护、审计日志三大安全能力。

## 职责

- 在文本写入系统剪贴板前去除不安全控制字符（防止终端注入）
- 防止 API 请求和 Agent 消息被恶意重放（Nonce + 时间戳 + 消息指纹）
- 记录和查询安全相关操作日志（认证、授权、数据访问等）
- 审计日志完整性签名（HMAC-SHA256），支持篡改检测

## 安全能力

| 能力         | 入口文件                  | 核心导出                                        | 说明                                                           |
| ------------ | ------------------------- | ----------------------------------------------- | -------------------------------------------------------------- |
| 剪贴板消毒   | `clipboardSanitizer.ts`   | `sanitizeClipboardText`, `inspectClipboardText` | 移除 ASCII 控制字符，保留 tab/LF/CR                            |
| 重放攻击防护 | `replayProtection.ts`     | `ReplayProtector`, `replayProtector`            | Nonce + 时间戳窗口 + SHA-256 消息指纹                          |
| 审计日志     | `audit/auditLogger.ts`    | `AuditLogger`, `getGlobalAuditLogger`           | 日志记录、RingBuffer 存储、JSONL 持久化（委托 jsonlPersister） |
| 审计存储     | `audit/auditStore.ts`     | `MemoryAuditStore`, `FileAuditStore`            | AuditStore 接口 + 内存/文件两种实现                            |
| 完整性校验   | `audit/integrity.ts`      | `stampEntry`, `verifyEntry`                     | HMAC-SHA256 签名与验证，Canonical JSON                         |
| 审计脱敏     | `audit/sanitize.ts`       | `sanitizeAuditData`                             | 敏感字段自动遮蔽(apiKey、token、password 等)，递归脱敏嵌套对象 |
| 审计导出     | `audit/exporter.ts`       | `exportAuditAsJson`, `exportAuditAsCsv`         | 审计日志 JSON/CSV 格式导出                                     |
| JSONL 持久化 | `audit/jsonlPersister.ts` | `JsonlPersister`                                | JSONL 文件追加/加载/原子写入/自动轮转                          |

## 文件结构

```
security/
├── index.ts                # 统一导出入口
├── clipboardSanitizer.ts   # 剪贴板文本消毒
├── replayProtection.ts      # 重放攻击防护（Nonce + 指纹）
└── audit/
    ├── auditLogger.ts      # 审计日志服务（记录 + RingBuffer + 持久化委托）
    ├── auditStore.ts       # 审计存储接口 + 内存/文件实现 + 共享过滤/统计
    ├── exporter.ts         # 审计日志导出工具（JSON/CSV）
    ├── integrity.ts         # HMAC-SHA256 完整性签名与验证
    ├── jsonlPersister.ts   # JSONL 文件读写工具（追加/加载/原子写入/轮转）
    └── sanitize.ts         # 审计日志脱敏（敏感字段遮蔽）
```

## 边界

- **剪贴板消毒**: 仅处理 ASCII 范围内控制字符 (U+0000-U+001F, U+007F-U+009F)，不影响 Unicode 高级字符 (CJK 等)；不做编码转换
- **重放防护**: 仅验证 Nonce/时间戳/指纹，不做身份认证或权限校验；缓存有容量上限，超限自动淘汰
- **审计日志**: 日志不可删除（生产环境），只能归档；查询仅覆盖内存中的条目（RingBuffer 有容量上限）；文件持久化为 JSONL 追加写入
- **完整性校验**: 旧条目（无 integrity 字段）视为未签名，查询仍可读但 verify 返回 false

## 使用示例

### 剪贴板消毒

```typescript
import { sanitizeClipboardText, inspectClipboardText } from "@/security";

// 快速消毒
const clean = sanitizeClipboardText(rawText);

// 完整诊断
const result = inspectClipboardText(rawText);
if (result.changed) {
  console.warn(`移除了 ${result.removedCount} 个控制字符`);
}
```

### 重放攻击防护

```typescript
import { replayProtector, createReplayProtector } from "@/security";

// 使用全局单例
const ctx = replayProtector.createRequestContext("session-123", "cli");
// ctx = { nonce: "1719...", timestamp: 1719..., sessionId: "session-123", source: "cli" }

// 验证请求
const result = replayProtector.validateRequest(ctx);
if (!result.valid) {
  console.error(`请求被拒绝: ${result.message}`);
}

// 验证 Agent 消息（防重放）
const msgResult = replayProtector.validateAgentMessage({
  role: "assistant",
  content: "Hello",
});
```

### 审计日志

```typescript
import { getGlobalAuditLogger, createAuditLogger } from "@/security";

// 使用全局实例（自动持久化到文件）
const logger = getGlobalAuditLogger();

// 记录认证事件
logger.logAuth("login", { success: true, subject: { userId: "u1", username: "alice" } });

// 记录授权事件
logger.logAuthz("tool.execute", { allowed: true, resource: { type: "tool", id: "bash" } });

// 记录安全事件
logger.logSecurityEvent("brute_force", { severity: "warning" });

// 查询日志
const recent = logger.query({ eventType: "authentication", limit: 50 });

// 验证完整性（需配置 integrityKey）
try {
  logger.verifyIntegrity(entry); // true = 签名匹配
} catch (e) {
  // IntegrityError: 签名不匹配（条目被篡改）
}
```

### 审计存储（独立使用）

```typescript
import { createMemoryStore, createFileStore } from "@/security";

// 内存存储
const memStore = createMemoryStore(5_000);
await memStore.save(entry);
const results = await memStore.query({ eventType: "authentication" });

// 文件存储（带容量限制）
const fileStore = createFileStore("./audit/audit.jsonl", 10_000);
await fileStore.save(entry);
```

### 审计数据脱敏

```typescript
import { sanitizeAuditData } from "@/security";

// 自动检测并遮蔽敏感字段
const sanitized = sanitizeAuditData({
  apiKey: "sk-1234567890abcdef",
  username: "alice",
  metadata: {
    token: "bearer_abc123",
    nested: {
      password: "secret123",
    },
  },
});
// 结果: { apiKey: "sk-1****cdef", username: "alice", metadata: { token: "bear****c123", nested: { password: "secr****123" } } }
```

## 依赖关系

```
clipboardSanitizer.ts        (无外部依赖，纯函数)

replayProtection.ts → @/core/logging/logger
                     → @/core/concurrency/ringBuffer
                     → @/core/id (nonce)

audit/auditLogger.ts → @/core/logging/logger
                      → @/core/concurrency/ringBuffer
                      → @/config (getCrabDir)
                      → audit/integrity.ts
                      → audit/auditStore.ts (applyAuditFilters, computeAuditStats)
                      → audit/exporter.ts (exportAuditAsJson, exportAuditAsCsv)
                      → audit/jsonlPersister.ts (JsonlPersister)
                      → @/core/id (auditId)
                      → audit/sanitize.ts

audit/auditStore.ts → @/core/logging/logger
                    → @/core/concurrency/ringBuffer
                    → audit/auditLogger.ts (类型引用)

audit/integrity.ts  (仅依赖 node:crypto，纯函数)
```

## 注意事项

- `ReplayProtector` (@experimental) 已在 `tool/executor/toolExecutor.ts` 中集成了基础重放检测。当前以非严格模式运行（`strictMode = false`），当请求缺少 `nonce`/`timestamp` 时自动放行，不会破坏现有工具调用流程。完整集成（严格模式、Nonce 生成注入）计划在未来版本中实现
- `AuditLogger` 的内存 RingBuffer 与文件持久化存在一致性差异：RingBuffer 有容量上限（溢出覆盖最旧条目），文件为 JSONL 追加写入（FileAuditStore 同样有 maxEntries 容量限制）。完整审计追溯应以文件为准
- `AuditLogger` 和 `FileAuditStore` 共享 `JsonlPersister` 进行 JSONL 文件读写（追加、加载、原子写入），消除了重复的文件操作代码。`AuditStore` 接口定义了统一的存储抽象
- `JsonlPersister` 支持文件轮转：当文件超过 `maxFileSize`（默认 10MB）时自动重命名为 `.1`、`.2`、... 并创建新文件，最多保留 `maxRotationFiles`（默认 3）个历史版本
- `AuditLogger.export()` 委托给 `audit/exporter.ts` 中的独立函数，实现了导出逻辑的单一职责
- `integrity.ts` 使用 `timingSafeEqual` 进行签名比较，防止时序攻击
- 配置参数均有安全上限校验（`validateAuditStoreConfig`、`validateReplayProtectionConfig`），防止配置炸弹
- `sanitizeAuditData()` 递归脱敏嵌套对象，最大深度 5 层（防止循环引用）；仅对 `string` 类型的值执行脱敏，其他类型原样透传；字段名匹配忽略大小写和连字符/下划线

## 测试

测试目录: `test/unit/security/`

运行测试:

```bash
bun test test/unit/security/ --no-coverage
```

当前覆盖: 220+ tests, 0 fail, 覆盖以下文件:

- `clipboardSanitizer.ts` — 控制字符/ANSI 移除、Unicode 保持
- `replayProtection.ts` — Nonce 验证、时间戳窗口、消息指纹、溢出清理、strictMode
- `auditLogger.ts` — 日志记录、查询、导出、脱敏、持久化、完整性签名
- `auditStore.ts` — 内存/文件存储、过滤/统计、容量限制、损坏行处理
- `integrity.ts` — HMAC-SHA256 签名/验证、Canonical JSON
- `sanitize.ts` — 敏感字段脱敏、大小写匹配、循环引用防护
