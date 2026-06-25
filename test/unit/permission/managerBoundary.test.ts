/**
 * PermissionManager 生命周期边界 — destroy/AbortSignal/并发/reject 持久化
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { PermissionManager } from "@/permission/manager/permission";
import type { PermissionRuleset } from "@/schema/permission";
import { closeDb, initDb } from "@/db";
import { clearAllApprovals } from "@/permission/store/approvalStore";
import { cleanupTestDir, createGlobalTmpTestDir } from "../../helpers/testPaths";
import { globalBus } from "@/bus";
import { AppEvent } from "@/bus";

const DEFAULT_RULES: PermissionRuleset = [
  { action: "allow", pattern: "**", permission: "fs.read" },
  { action: "allow", pattern: "ls *", permission: "bash" },
  { action: "deny", pattern: "sudo *", permission: "bash" },
  { action: "ask", pattern: "*", permission: "bash" },
];

let tempDir = "";
let originalXdgDataHome: string | undefined;

beforeEach(() => {
  tempDir = createGlobalTmpTestDir("perm-boundary-");
  originalXdgDataHome = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = tempDir;
  initDb();
  clearAllApprovals();
});

afterEach(() => {
  clearAllApprovals();
  closeDb();
  if (originalXdgDataHome !== undefined) {
    process.env.XDG_DATA_HOME = originalXdgDataHome;
  } else {
    delete process.env.XDG_DATA_HOME;
  }
  cleanupTestDir(tempDir);
  tempDir = "";
});

describe("PermissionManager — destroy 边界", () => {
  test("destroy 后调用 ask() 抛出明确错误", async () => {
    const pm = new PermissionManager(DEFAULT_RULES);
    pm.destroy();
    await expect(pm.ask({ patterns: ["ls"], permission: "bash", tool: "bash" })).rejects.toThrow("已销毁");
  });

  test("重复 destroy 幂等", () => {
    const pm = new PermissionManager(DEFAULT_RULES);
    expect(() => {
      pm.destroy();
      pm.destroy();
    }).not.toThrow();
  });

  test("destroy 后 getApprovedRules 仍可读取", () => {
    const pm = new PermissionManager(DEFAULT_RULES);
    pm.approve("bash", "npm *");
    pm.destroy();
    expect(pm.getApprovedRules()).toHaveLength(1);
  });
});

describe("PermissionManager — AbortSignal", () => {
  test("AbortSignal 预取消时直接拒绝", async () => {
    const controller = new AbortController();
    controller.abort();
    const pm = new PermissionManager(DEFAULT_RULES, "test", undefined, controller.signal);
    const result = await pm.ask({ patterns: ["npm install"], permission: "bash", tool: "bash" });
    expect(result).toBe(false);
    pm.destroy();
  });

  test("AbortSignal 中途触发自动拒绝待确认请求", async () => {
    const controller = new AbortController();
    const pm = new PermissionManager(DEFAULT_RULES, "test", undefined, controller.signal);

    // 发布一个需要审批的请求
    const askPromise = pm.ask({ patterns: ["npm install"], permission: "bash", tool: "bash" });

    // 中途触发 abort
    await new Promise((r) => setTimeout(r, 50));
    controller.abort();

    const result = await askPromise;
    expect(result).toBe(false);
    pm.destroy();
  });
});

describe("PermissionManager — reject 持久化", () => {
  test("reject 后同类命令自动拒绝（会话级 deny 规则）", async () => {
    const pm = new PermissionManager(DEFAULT_RULES);

    // 第一次: 使用 requestApprovalHandler 模拟用户拒绝
    const handler = async (input: { patterns: string[] }) => {
      // 第一个 pattern 触发拒绝
      for (const pattern of input.patterns) {
        pm.deny("bash", pattern);
      }
      return "reject" as const;
    };

    const pmWithHandler = new PermissionManager(DEFAULT_RULES, "test", handler);

    // 第一次: 触发审批 → reject
    const result1 = await pmWithHandler.ask({ patterns: ["npm install crab"], permission: "bash", tool: "bash" });
    expect(result1).toBe(false);

    // 第二次: 同类命令应被自动拒绝（命中 deny 列表）
    const result2 = await pmWithHandler.ask({ patterns: ["npm install crab"], permission: "bash", tool: "bash" });
    expect(result2).toBe(false);

    pmWithHandler.destroy();
    pm.destroy();
  });
});

describe("PermissionManager — preCheck API", () => {
  test("preCheck 对单个 pattern 返回正确的评估结果", () => {
    const pm = new PermissionManager(DEFAULT_RULES);

    // "ls -la" 匹配默认规则 "ls *" → allow
    const lsResults = pm.preCheck({ permission: "bash", patterns: ["ls -la"], tool: "bash" });
    expect(lsResults).toHaveLength(1);
    expect(lsResults[0]!.action).toBe("allow");
    expect(lsResults[0]!.pattern).toBe("ls -la");

    // "sudo rm -rf /" 匹配默认规则 "sudo *" → deny
    const sudoResults = pm.preCheck({ permission: "bash", patterns: ["sudo rm -rf /"], tool: "bash" });
    expect(sudoResults).toHaveLength(1);
    expect(sudoResults[0]!.action).toBe("deny");
    expect(sudoResults[0]!.pattern).toBe("sudo rm -rf /");

    pm.destroy();
  });

  test("preCheck 多 pattern 时每个 pattern 独立评估", () => {
    const pm = new PermissionManager(DEFAULT_RULES);
    // 修复后: preCheck 对每个 pattern 独立评估默认规则，不受其他 pattern 影响
    const results = pm.preCheck({ permission: "bash", patterns: ["ls -la", "sudo rm -rf /"], tool: "bash" });
    expect(results).toHaveLength(2);
    // "ls -la" 匹配 "ls *" → allow
    expect(results[0]!.action).toBe("allow");
    // "sudo rm -rf /" 匹配 "sudo *" → deny
    expect(results[1]!.action).toBe("deny");
    pm.destroy();
  });

  test("preCheck 不触发 UI 事件", () => {
    const pm = new PermissionManager(DEFAULT_RULES);

    let eventCount = 0;
    const unsub = globalBus.subscribe(AppEvent.PermissionAsked, () => {
      eventCount++;
    });

    pm.preCheck({ permission: "bash", patterns: ["npm install"], tool: "bash" });

    expect(eventCount).toBe(0);
    unsub();
    pm.destroy();
  });

  test("preCheck 对已批准的命令返回 allow", () => {
    const pm = new PermissionManager(DEFAULT_RULES);
    pm.approve("bash", "npm *");

    const results = pm.preCheck({ permission: "bash", patterns: ["npm install"], tool: "bash" });
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({ pattern: "npm install", action: "allow", source: "session-approve" });
    pm.destroy();
  });

  test("preCheck 对已拒绝的命令返回 deny", () => {
    const pm = new PermissionManager(DEFAULT_RULES);
    pm.deny("bash", "dangerous-cmd");

    const results = pm.preCheck({ permission: "bash", patterns: ["dangerous-cmd"], tool: "bash" });
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({ pattern: "dangerous-cmd", action: "deny", source: "session-deny" });
    pm.destroy();
  });
});
