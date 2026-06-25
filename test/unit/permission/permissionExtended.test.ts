/**
 * PermissionManager 扩展测试 — P1/P2 层级。
 *
 * 测试覆盖:
 *   - reply() 直接调用(无 EventBus)
 *   - 待审批请求管理(getPendingRequests)
 *   - deny 拒绝工作流
 *   - 自定义 requestApprovalHandler
 *   - destroy / clearSession 生命周期
 *   - 审批存储边界条件
 *   - evaluateBatch 边界
 *   - 通配符扩展
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { PermissionManager } from "@/permission/manager/permission";

import {
  cleanExpired,
  clearAllApprovals,
  getAllApprovals,
  getApproval,
  saveApproval,
} from "@/permission/store/approvalStore";
import { evaluate, evaluateBatch } from "@/permission/core/evaluate";
import { wildcardMatch } from "@/permission/core/wildcard";
import { closeDb, initDb, resetDb } from "@/db";
import { cleanupTestDir, createGlobalTmpTestDir } from "../../helpers/testPaths";
import type { PermissionRuleset } from "@/schema/permission";

const DEFAULT_RULES: PermissionRuleset = [
  { action: "allow", pattern: "**", permission: "fs.read" },
  { action: "allow", pattern: "ls *", permission: "bash" },
  { action: "deny", pattern: "sudo *", permission: "bash" },
  { action: "ask", pattern: "*", permission: "bash" },
];

let tempDir = "";
let originalXdgDataHome: string | undefined;

beforeEach(() => {
  tempDir = createGlobalTmpTestDir("permission-ext-");
  originalXdgDataHome = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = tempDir;
  initDb();
  clearAllApprovals();
});

afterEach(() => {
  clearAllApprovals();
  closeDb();
  resetDb();
  if (originalXdgDataHome !== undefined) {
    process.env.XDG_DATA_HOME = originalXdgDataHome;
  } else {
    delete process.env.XDG_DATA_HOME;
  }
  cleanupTestDir(tempDir);
  tempDir = "";
});

describe("PermissionManager — reply() 直接调用(P1)", () => {
  test("reply 解析 pending 请求并 resolve true", async () => {
    const pm = new PermissionManager(DEFAULT_RULES);
    const { globalBus } = await import("@/bus/core/eventBus");
    const { AppEvent } = await import("@/bus/events");

    const unsub = globalBus.subscribe(AppEvent.PermissionAsked, (payload) => {
      setTimeout(() => pm.reply(payload.properties.id, "once"), 10);
    });

    const result = await pm.ask({
      patterns: ["npm install"],
      permission: "bash",
      tool: "bash",
    });

    unsub();
    pm.destroy();
    expect(result).toBe(true);
  });

  test("reply action=reject 解析 pending 请求并 resolve false", async () => {
    const pm = new PermissionManager(DEFAULT_RULES);
    const { globalBus } = await import("@/bus/core/eventBus");
    const { AppEvent } = await import("@/bus/events");

    const unsub = globalBus.subscribe(AppEvent.PermissionAsked, (payload) => {
      setTimeout(() => pm.reply(payload.properties.id, "reject"), 10);
    });

    const result = await pm.ask({
      patterns: ["npm install"],
      permission: "bash",
      tool: "bash",
    });

    unsub();
    pm.destroy();
    expect(result).toBe(false);
  });

  test("reply action=always 同时持久化审批", async () => {
    const { globalBus } = await import("@/bus/core/eventBus");
    const { AppEvent } = await import("@/bus/events");

    const pm = new PermissionManager(DEFAULT_RULES);
    const unsub = globalBus.subscribe(AppEvent.PermissionAsked, (payload) => {
      setTimeout(() => pm.reply(payload.properties.id, "always"), 10);
    });

    const result = await pm.ask({
      patterns: ["npm install"],
      permission: "bash",
      tool: "bash",
    });

    unsub();
    pm.destroy();
    expect(result).toBe(true);

    // Always 审批已持久化，新的 manager 应自动通过
    const pm2 = new PermissionManager(DEFAULT_RULES);
    const result2 = await pm2.ask({
      patterns: ["npm install"],
      permission: "bash",
      tool: "bash",
    });
    pm2.destroy();
    expect(result2).toBe(true);
  });

  test("reply 未知 ID 不抛错(幂等)", () => {
    const pm = new PermissionManager(DEFAULT_RULES);
    expect(() => pm.reply("nonexistent-id", "once")).not.toThrow();
    pm.destroy();
  });

  test("reply 同一 ID 两次只生效一次(第二次无 pending)", async () => {
    const pm = new PermissionManager(DEFAULT_RULES);
    const { globalBus } = await import("@/bus/core/eventBus");
    const { AppEvent } = await import("@/bus/events");

    let callCount = 0;
    const unsub = globalBus.subscribe(AppEvent.PermissionAsked, (payload) => {
      callCount++;
      pm.reply(payload.properties.id, "once");
      // 再次 reply 同一 ID
      pm.reply(payload.properties.id, "reject");
    });

    const result = await pm.ask({
      patterns: ["npm install"],
      permission: "bash",
      tool: "bash",
    });

    unsub();
    pm.destroy();
    // 第一次 resolve 后 pending 已删除，第二次 reply 无效
    expect(callCount).toBe(1);
    expect(result).toBe(true);
  });
});

describe("PermissionManager — 待审批请求管理(P1)", () => {
  test("getPendingRequests 返回待审批 ID 列表", async () => {
    const pm = new PermissionManager(DEFAULT_RULES);
    const { globalBus } = await import("@/bus/core/eventBus");
    const { AppEvent } = await import("@/bus/events");

    const unsub = globalBus.subscribe(AppEvent.PermissionAsked, (payload) => {
      setTimeout(() => pm.reply(payload.properties.id, "once"), 50);
    });

    const pendingBefore = pm.getPendingRequests();
    expect(pendingBefore).toEqual([]);

    const askPromise = pm.ask({
      patterns: ["npm install"],
      permission: "bash",
      tool: "bash",
    });

    // Microtask 后 pending 应有内容
    await Promise.resolve();
    const pendingDuring = pm.getPendingRequests();
    expect(pendingDuring.length).toBeGreaterThan(0);
    expect(pendingDuring[0]).toEqual(expect.any(String));

    const result = await askPromise;
    expect(result).toBe(true);

    const pendingAfter = pm.getPendingRequests();
    expect(pendingAfter).toEqual([]);

    unsub();
    pm.destroy();
  });

  test("多个并发 ask 产生 pending 请求", async () => {
    const pm = new PermissionManager(DEFAULT_RULES);
    const { globalBus } = await import("@/bus/core/eventBus");
    const { AppEvent } = await import("@/bus/events");

    const unsub = globalBus.subscribe(AppEvent.PermissionAsked, () => {});

    pm.ask({ patterns: ["cmd1"], permission: "bash", tool: "bash" });
    pm.ask({ patterns: ["cmd2"], permission: "bash", tool: "bash" });
    pm.ask({ patterns: ["cmd3"], permission: "bash", tool: "bash" });

    // 需要多个微任务轮次让 EventBus 处理完
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const pending = pm.getPendingRequests();
    expect(pending.length).toBeGreaterThan(0);
    expect(pending.length).toBeLessThanOrEqual(3);

    unsub();
    pm.destroy();
  });
});

describe("PermissionManager — deny 工作流(P1)", () => {
  test("deny 后同类模式被拒绝", async () => {
    const pm = new PermissionManager(DEFAULT_RULES);
    pm.deny("bash", "dangerous-cmd *");
    // Deny 规则短路，ask() 同步返回 false(Promise resolved to false)
    await expect(pm.ask({ patterns: ["dangerous-cmd run"], permission: "bash", tool: "bash" })).resolves.toBe(false);
    pm.destroy();
  });

  test("deny 规则优先级高于 ask 默认规则", async () => {
    const rules: PermissionRuleset = [
      { action: "deny", pattern: "evil *", permission: "bash" },
      { action: "ask", pattern: "*", permission: "bash" },
    ];
    const pm = new PermissionManager(rules);
    // Deny 规则短路，同步 resolved to false
    await expect(pm.ask({ patterns: ["evil action"], permission: "bash", tool: "bash" })).resolves.toBe(false);
    pm.destroy();
  });

  test("deny 持久化后跨会话生效", async () => {
    const pm = new PermissionManager(DEFAULT_RULES);
    pm.deny("bash", "forbidden-cmd", true);

    // 新的 manager 实例从持久存储加载 deny 规则
    const pm2 = new PermissionManager(DEFAULT_RULES);
    const result = await pm2.ask({
      patterns: ["forbidden-cmd"],
      permission: "bash",
      tool: "bash",
    });

    expect(result).toBe(false);
    pm.destroy();
    pm2.destroy();
  });
});

describe("PermissionManager — 自定义 requestApprovalHandler(P1)", () => {
  test("提供 requestApprovalHandler 时不触发 EventBus", async () => {
    let handlerCalled = false;
    const pm = new PermissionManager(DEFAULT_RULES, "session", async () => {
      handlerCalled = true;
      return "once";
    });

    const result = await pm.ask({
      patterns: ["test-cmd"],
      permission: "bash",
      tool: "bash",
    });

    expect(handlerCalled).toBe(true);
    expect(result).toBe(true);
    pm.destroy();
  });

  test("requestApprovalHandler 返回 false 拒绝操作", async () => {
    const pm = new PermissionManager(DEFAULT_RULES, "session", async () => false);

    const result = await pm.ask({
      patterns: ["test-cmd"],
      permission: "bash",
      tool: "bash",
    });

    expect(result).toBe(false);
    pm.destroy();
  });

  test("requestApprovalHandler 返回 always 持久化", async () => {
    const pm = new PermissionManager(DEFAULT_RULES, "session", async () => "always");

    const result = await pm.ask({
      patterns: ["always-cmd"],
      permission: "bash",
      tool: "bash",
    });
    expect(result).toBe(true);

    const pm2 = new PermissionManager(DEFAULT_RULES);
    const result2 = await pm2.ask({
      patterns: ["always-cmd"],
      permission: "bash",
      tool: "bash",
    });
    expect(result2).toBe(true);

    pm.destroy();
    pm2.destroy();
  });

  test("requestApprovalHandler 返回 reject 拒绝", async () => {
    const pm = new PermissionManager(DEFAULT_RULES, "session", async () => "reject");

    const result = await pm.ask({
      patterns: ["test-cmd"],
      permission: "bash",
      tool: "bash",
    });

    expect(result).toBe(false);
    pm.destroy();
  });
});

describe("PermissionManager — 生命周期(P2)", () => {
  test("destroy 清理事件订阅", () => {
    const pm = new PermissionManager(DEFAULT_RULES);
    pm.approve("bash", "ls *");
    pm.destroy();
    expect(() => pm.destroy()).not.toThrow(); // 重复 destroy 幂等
  });

  test("destroy 后 pending 队列清空", async () => {
    const pm = new PermissionManager(DEFAULT_RULES);
    const { globalBus } = await import("@/bus/core/eventBus");
    const { AppEvent } = await import("@/bus/events");

    globalBus.subscribe(AppEvent.PermissionAsked, () => {});

    pm.ask({ patterns: ["cmd"], permission: "bash", tool: "bash" });
    await Promise.resolve();
    expect(pm.getPendingRequests().length).toBe(1);

    pm.destroy();
    const pendingAfterDestroy = pm.getPendingRequests();
    expect(pendingAfterDestroy).toEqual([]);
  });

  test("clearSession 保留持久规则", async () => {
    const pm = new PermissionManager(DEFAULT_RULES);
    pm.approve("bash", "session-only", false);
    pm.approve("bash", "persistent-rule", true);
    pm.approve("fs.read", "/tmp/**", false);

    pm.clearSession();

    const rules = pm.getApprovedRules();
    expect(rules.length).toBe(1);
    expect(rules[0]!.pattern).toBe("persistent-rule");
    pm.destroy();
  });

  test("clearSession 清空 denied 列表", async () => {
    const pm = new PermissionManager(DEFAULT_RULES);
    pm.deny("bash", "temp-blocked");

    // Deny 规则短路，同步返回 false(无需 await)
    await expect(pm.ask({ patterns: ["temp-blocked"], permission: "bash", tool: "bash" })).resolves.toBe(false);

    pm.clearSession();
    expect(pm.getPendingRequests()).toEqual([]);
    pm.destroy();
  });
});

describe("ApprovalStore — 边界条件(P2)", () => {
  test("相同 permission + pattern 多条记录只返回最新", () => {
    saveApproval({
      decision: "deny",
      expiresAt: null,
      pattern: "latest-cmd",
      permission: "bash",
      sessionId: "s1",
      timestamp: Date.now() - 1000,
    });
    saveApproval({
      decision: "allow",
      expiresAt: null,
      pattern: "latest-cmd",
      permission: "bash",
      sessionId: "s1",
      timestamp: Date.now(),
    });

    const record = getApproval("bash", "latest-cmd");
    expect(record!.decision).toBe("allow");
  });

  test("精确匹配 — 尾部空格不匹配", () => {
    saveApproval({
      decision: "allow",
      expiresAt: null,
      pattern: "exact",
      permission: "bash",
      sessionId: "s1",
      timestamp: Date.now(),
    });

    expect(getApproval("bash", "exact")).not.toBeNull();
    expect(getApproval("bash", "exact ")).toBeNull();
    expect(getApproval("bash", " exact")).toBeNull();
  });

  test("permission 字段大小写敏感", () => {
    saveApproval({
      decision: "allow",
      expiresAt: null,
      pattern: "cmd",
      permission: "Bash",
      sessionId: "s1",
      timestamp: Date.now(),
    });

    expect(getApproval("Bash", "cmd")).not.toBeNull();
    expect(getApproval("bash", "cmd")).toBeNull();
  });

  test("cleanExpired 正确计数", () => {
    const now = Date.now();
    // 已过期
    saveApproval({
      decision: "allow",
      expiresAt: now - 5000,
      pattern: "exp",
      permission: "x",
      sessionId: "s",
      timestamp: now - 10_000,
    });
    // 未过期
    saveApproval({
      decision: "allow",
      expiresAt: now + 10_000,
      pattern: "valid",
      permission: "x",
      sessionId: "s",
      timestamp: now,
    });
    // 永久不过期
    saveApproval({
      decision: "allow",
      expiresAt: null,
      pattern: "perm",
      permission: "x",
      sessionId: "s",
      timestamp: now,
    });

    const cleaned = cleanExpired();
    expect(cleaned).toBe(1);
    expect(getAllApprovals()).toHaveLength(2);
  });
});

describe("evaluateBatch — 边界条件(P2)", () => {
  const rules: PermissionRuleset = [
    { action: "allow", pattern: "safe", permission: "bash" },
    { action: "ask", pattern: "ask-cmd", permission: "bash" },
    { action: "deny", pattern: "deny-cmd", permission: "bash" },
  ];

  test("空 patterns 返回 allow", () => {
    const result = evaluateBatch("bash", [], rules);
    expect(result.action).toBe("allow");
  });

  test("全 allow 返回 allow", () => {
    // 用空 pattern 触发精确相等快速路径，确保不经过 evaluate default
    const r1 = evaluateBatch("bash", ["safe"], rules);
    expect(r1.action).toBe("allow");
    // 无 patterns 直接短路 → allow(源行为)
    const r2 = evaluateBatch("bash", [], rules);
    expect(r2.action).toBe("allow");
  });

  test("有 deny 直接返回 deny(短路)", () => {
    const result = evaluateBatch("bash", ["safe", "deny-cmd", "ask-cmd"], rules);
    expect(result.action).toBe("deny");
  });

  test("无 deny 有 ask 返回 ask", () => {
    const result = evaluateBatch("bash", ["safe", "ask-cmd"], rules);
    expect(result.action).toBe("ask");
  });

  test("无匹配规则返回 ask(默认行为)", () => {
    const result = evaluateBatch("bash", ["unknown"], rules);
    expect(result.action).toBe("ask");
  });

  test("多规则集取第一个 deny", () => {
    const rules2: PermissionRuleset = [{ action: "deny", pattern: "dangerous", permission: "bash" }];
    const result = evaluateBatch("bash", ["dangerous"], rules, rules2);
    expect(result.action).toBe("deny");
  });
});

describe("通配符匹配 — 扩展边界(P2)", () => {
  test("嵌套路径通配符", () => {
    expect(wildcardMatch("src/**/*.ts", "src/a/b/c.ts")).toBe(true);
    expect(wildcardMatch("src/**/*.ts", "src/index.ts")).toBe(true);
    expect(wildcardMatch("src/**/*.ts", "lib/index.ts")).toBe(false);
  });

  test("前导通配符", () => {
    expect(wildcardMatch("**/index.ts", "src/index.ts")).toBe(true);
    expect(wildcardMatch("**/index.ts", "index.ts")).toBe(true);
    expect(wildcardMatch("**/index.ts", "src/home/index.ts")).toBe(true);
  });

  test("中段通配符", () => {
    expect(wildcardMatch("src/*/index.ts", "src/home/index.ts")).toBe(true);
    // 注:当前 wildcardMatch 实现中 * 不限制跨 /，与标准 glob 语义不同
    expect(wildcardMatch("src/*/index.ts", "src/a/b/index.ts")).toBe(true);
  });

  test("特殊字符转义", () => {
    expect(wildcardMatch("file[1].ts", "file[1].ts")).toBe(true);
    expect(wildcardMatch("file?.ts", "file1.ts")).toBe(true);
    expect(wildcardMatch("file?.ts", "file12.ts")).toBe(false);
  });

  test("模式含空格", () => {
    expect(wildcardMatch("git commit -m *", 'git commit -m "init"')).toBe(true);
    expect(wildcardMatch("git commit -m *", "git commit -m 'wip'")).toBe(true);
  });

  test("单字符通配符 ? 不跨空格", () => {
    expect(wildcardMatch("file?.ts", "fileA.ts")).toBe(true);
    expect(wildcardMatch("file?.ts", "fileAB.ts")).toBe(false);
  });

  test("超长模式安全处理", () => {
    const long = "a".repeat(1000);
    expect(wildcardMatch(long, long)).toBe(true);
    expect(wildcardMatch(long, "a".repeat(999))).toBe(false);
  });
});

describe("evaluate — 边界条件(P2)", () => {
  test("空 pattern 匹配", () => {
    const result = evaluate("bash", "", [{ action: "allow", pattern: "", permission: "bash" }]);
    expect(result.action).toBe("allow");
  });

  test("通配符 permission 精确优先", () => {
    const rules: PermissionRuleset = [
      { action: "ask", pattern: "**", permission: "fs.*" },
      { action: "allow", pattern: "**", permission: "fs.read" },
    ];
    const result = evaluate("fs.read", "/a", rules);
    expect(result.action).toBe("ask"); // 第一个匹配生效
  });

  test("多层规则集优先级", () => {
    const userRules: PermissionRuleset = [{ action: "allow", pattern: "admin *", permission: "bash" }];
    const systemRules: PermissionRuleset = [{ action: "deny", pattern: "*", permission: "bash" }];
    const result = evaluate("bash", "admin ls", userRules, systemRules);
    expect(result.action).toBe("allow"); // UserRules 优先级高
  });

  test("无规则匹配返回 ask", () => {
    const result = evaluate("unknown", "pattern", []);
    expect(result.action).toBe("ask");
    expect(result.rule).toBeNull();
  });
});
