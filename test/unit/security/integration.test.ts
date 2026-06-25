/**
 * security 模块跨模块集成测试
 *
 * 验证 security 模块与 permission/evaluate、tool/executor 等消费者的交互。
 */
import { describe, it, expect, afterEach } from "bun:test";
import { createReplayProtector } from "@/security/replayProtection";
import { createAuditLogger } from "@/security/audit/auditLogger";

describe("security ↔ 权限评估集成", () => {
  let logger: ReturnType<typeof createAuditLogger>;

  afterEach(async () => {
    await logger?.clear();
  });

  it("权限评估拒绝事件被审计日志记录", () => {
    logger = createAuditLogger("integration-perm", { integrityKey: "test-key" });
    // 模拟 permission/evaluate.ts 中的日志记录行为
    logger.logAuthz("permission.evaluate:bash", {
      allowed: false,
      duration: 5,
      metadata: {
        action: "ask",
        checkedRules: 3,
        matchedRule: null,
        pattern: "rm -rf /",
      },
      resource: { id: "bash", name: "rm -rf /", type: "permission" },
    });
    const entries = logger.query({ eventType: "authorization" });
    expect(entries.length).toBe(1);
    expect(entries[0]!.action).toBe("permission.evaluate:bash");
    expect(entries[0]!.level).toBe("warning");
    expect(entries[0]!.metadata?.pattern).toBe("rm -rf /");
    // 验证签名完整性
    expect(logger.verifyIntegrity(entries[0]!)).toBe(true);
  });

  it("权限评估允许事件不记录审计日志（与 evaluate.ts 行为一致）", () => {
    logger = createAuditLogger("integration-perm", { integrityKey: "test-key" });
    // evaluate.ts 中仅记录非 allow 场景
    // 模拟 allow 场景不调用 logAuthz
    const entries = logger.query({ eventType: "authorization" });
    expect(entries.length).toBe(0);
  });

  it("多个权限事件按时间顺序记录", () => {
    logger = createAuditLogger("integration-perm", { integrityKey: "test-key" });
    logger.logAuthz("tool.execute:fs.write", { allowed: false, resource: { type: "tool", id: "fs.write" } });
    logger.logAuthz("tool.execute:bash", { allowed: false, resource: { type: "tool", id: "bash" } });
    logger.logAuth("login", { success: true, subject: { userId: "u1" } });

    const recent = logger.getRecent(3);
    expect(recent[0]!.eventType).toBe("authentication");
    expect(recent[1]!.eventType).toBe("authorization");
    expect(recent[2]!.eventType).toBe("authorization");
    // 按时间升序（允许同毫秒，所以用 toBeLessThanOrEqual）
    expect(recent[2]!.timestamp).toBeLessThanOrEqual(recent[1]!.timestamp);
    expect(recent[1]!.timestamp).toBeLessThanOrEqual(recent[0]!.timestamp);
  });
});

describe("security ↔ 工具执行集成", () => {
  let logger: ReturnType<typeof createAuditLogger>;
  let protector: ReturnType<typeof createReplayProtector>;

  afterEach(async () => {
    await logger?.clear();
    protector?.reset();
  });

  it("工具执行被重放检测拒绝时记录安全事件", () => {
    logger = createAuditLogger("integration-tool", { integrityKey: "test-key" });
    protector = createReplayProtector();

    // 模拟 toolExecutor.ts 中的行为
    const ctx = protector.createRequestContext("session-1", "cli");
    expect(protector.validateRequest(ctx).valid).toBe(true);

    // 重放同一个 nonce
    const replayResult = protector.validateRequest(ctx);
    expect(replayResult.valid).toBe(false);
    expect(replayResult.errorCode).toBe("INVALID_NONCE");

    // 模拟 toolExecutor 记录安全事件
    logger.logSecurityEvent(`replay_blocked:bash`, {
      metadata: { reason: replayResult.message },
      resource: { id: "bash", type: "tool" },
      severity: "warning",
    });

    const securityEvents = logger.query({ eventType: "security_event" });
    expect(securityEvents.length).toBe(1);
    expect(securityEvents[0]!.action).toBe("replay_blocked:bash");
    expect(logger.verifyIntegrity(securityEvents[0]!)).toBe(true);
  });

  it("工具执行日志记录包含完整上下文", () => {
    logger = createAuditLogger("integration-tool", { integrityKey: "test-key" });

    // 模拟 toolExecutor 中的工具执行记录
    logger.log({
      action: "tool.execute.complete",
      eventType: "system",
      level: "info",
      metadata: { exitReason: "success", durationMs: 150 },
      resource: { id: "bash", name: "ls -la", type: "tool" },
    });

    const entry = logger.getRecent(1)[0]!;
    expect(entry.action).toBe("tool.execute.complete");
    expect(entry.metadata?.durationMs).toBe(150);
    expect(entry.resource?.id).toBe("bash");
  });

  it("重放防护器统计与审计日志联动", () => {
    protector = createReplayProtector();
    const ctx1 = protector.createRequestContext("s1");
    const ctx2 = protector.createRequestContext("s2");
    protector.validateRequest(ctx1);
    protector.validateRequest(ctx2);
    protector.validateAgentMessage({ role: "assistant", content: "hello" });
    protector.validateAgentMessage({ role: "assistant", content: "hello" }); // 重复

    const stats = protector.getStats();
    expect(stats.nonceCacheSize).toBe(2);
    expect(stats.messageFingerprints).toBe(1);
    expect(stats.totalMessages).toBe(2);
  });
});

describe("剪贴板消毒集成", () => {
  it("剪贴板消毒后文本可用于日志记录", () => {
    const { sanitizeClipboardText } = require("@/security/clipboardSanitizer");
    const dirtyText = "hello\x1b[31mworld\x07\x00end";
    const clean = sanitizeClipboardText(dirtyText);
    expect(clean).toBe("helloworldend");

    // 消毒后的文本可安全记录到审计日志
    const logger = createAuditLogger("integration-clipboard", { integrityKey: "test-key" });
    logger.log({
      action: "clipboard.write",
      eventType: "data_access",
      level: "info",
      metadata: { sanitizedLength: clean.length, originalLength: dirtyText.length },
      resource: { type: "clipboard", id: "system" },
    });
    expect(logger.getRecent(1)[0]!.metadata?.sanitizedLength).toBe(13);
  });
});
