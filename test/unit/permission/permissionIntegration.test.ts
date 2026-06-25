/**
 * 完整权限流程集成测试 — tool call → ask → approve → persist → 下次 auto-allow
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { PermissionManager } from "@/permission/manager/permission";
import type { PermissionRuleset } from "@/schema/permission";
import { closeDb, initDb } from "@/db";
import { clearAllApprovals, getAllApprovals } from "@/permission/store/approvalStore";
import { cleanupTestDir, createGlobalTmpTestDir } from "../../helpers/testPaths";

const DEFAULT_RULES: PermissionRuleset = [
  { action: "allow", pattern: "**", permission: "fs.read" },
  { action: "ask", pattern: "*", permission: "bash" },
];

let tempDir = "";
let originalXdgDataHome: string | undefined;

beforeEach(() => {
  tempDir = createGlobalTmpTestDir("perm-integration-");
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

describe("完整权限流程集成", () => {
  test("once 审批: 不持久化，下次仍需询问", async () => {
    const pm = new PermissionManager(DEFAULT_RULES);

    // 第一次: 通过 handler 批准 once
    const pmWithHandler = new PermissionManager(DEFAULT_RULES, "test", async () => "once" as const);

    const result1 = await pmWithHandler.ask({
      permission: "bash",
      patterns: ["npm install"],
      tool: "bash",
    });
    expect(result1).toBe(true);

    // 确认未持久化
    const approvals = getAllApprovals();
    expect(approvals).toHaveLength(0);

    pmWithHandler.destroy();
    pm.destroy();
  });

  test("always 审批: 持久化，下次自动允许", async () => {
    const EXACT_PATTERN = "npm install";

    // 第一次: 通过 handler 批准 always
    const pmWithHandler = new PermissionManager(DEFAULT_RULES, "test", async () => "always" as const);

    const result1 = await pmWithHandler.ask({
      permission: "bash",
      patterns: [EXACT_PATTERN],
      tool: "bash",
    });
    expect(result1).toBe(true);

    // 确认已持久化（getApproval 使用精确匹配）
    const approvals = getAllApprovals();
    expect(approvals.some((a) => a.pattern === EXACT_PATTERN && a.decision === "allow")).toBe(true);

    pmWithHandler.destroy();

    // 第二个 manager 实例（模拟新会话）应从持久化自动允许
    const pm2 = new PermissionManager(DEFAULT_RULES, "test");
    const result2 = await pm2.ask({
      permission: "bash",
      patterns: [EXACT_PATTERN],
      tool: "bash",
    });
    expect(result2).toBe(true); // 从持久化加载

    pm2.destroy();
  });

  test("reject 后重复请求仍需确认（会话级 deny）", async () => {
    let isFirstCall = true;
    const pm = new PermissionManager(DEFAULT_RULES, "test", async () => {
      if (isFirstCall) {
        isFirstCall = false;
        return "reject" as const;
      }
      return "once" as const;
    });

    // 第一次: reject
    const result1 = await pm.ask({
      permission: "bash",
      patterns: ["npm install crab"],
      tool: "bash",
    });
    expect(result1).toBe(false);

    // 第二次: 同一 pattern，因会话级 deny 应自动拒绝
    const result2 = await pm.ask({
      permission: "bash",
      patterns: ["npm install crab"],
      tool: "bash",
    });
    expect(result2).toBe(false);

    pm.destroy();
  });

  test("高风险 always 自动降级为 session-only", async () => {
    const pm = new PermissionManager(DEFAULT_RULES, "test", async () => "always" as const);

    const result = await pm.ask({
      permission: "bash",
      patterns: ["rm -rf /"],
      tool: "bash",
    });
    // 高风险 always 降级为 once，但仍返回 true
    expect(result).toBe(true);

    // 降级后不应持久化
    const approvals = getAllApprovals();
    const rmApproval = approvals.find((a) => a.pattern === "rm -rf /");
    expect(rmApproval).toBeUndefined();

    pm.destroy();
  });

  test("destroy 后新建 manager 持久化审批仍有效", async () => {
    const EXACT_PATTERN = "npm install";

    // 第一个 manager 持久化批准
    const pm1 = new PermissionManager(DEFAULT_RULES, "session-1");
    pm1.approve("bash", EXACT_PATTERN, true); // 持久化批准

    const approvals = getAllApprovals();
    expect(approvals.some((a) => a.pattern === EXACT_PATTERN && a.decision === "allow")).toBe(true);

    pm1.destroy();

    // 新会话: 应从持久化自动允许
    const pm2 = new PermissionManager(DEFAULT_RULES, "session-2");
    const result = await pm2.ask({
      permission: "bash",
      patterns: [EXACT_PATTERN],
      tool: "bash",
    });
    expect(result).toBe(true);

    pm2.destroy();
  });
});
