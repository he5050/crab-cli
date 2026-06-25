/**
 * preCheck 与持久化审批交互测试 — 验证 preCheck 不查持久化的设计语义
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { PermissionManager } from "@/permission/manager/permission";
import type { PermissionRuleset } from "@/schema/permission";
import { closeDb, initDb } from "@/db";
import { clearAllApprovals } from "@/permission/store/approvalStore";
import { cleanupTestDir, createGlobalTmpTestDir } from "../../helpers/testPaths";

const DEFAULT_RULES: PermissionRuleset = [
  { action: "allow", pattern: "**", permission: "fs.read" },
  { action: "ask", pattern: "*", permission: "bash" },
];

let tempDir = "";
let originalXdgDataHome: string | undefined;

beforeEach(() => {
  tempDir = createGlobalTmpTestDir("perm-precheck-persist-");
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

describe("preCheck — 不检查持久化审批", () => {
  test("preCheck 对持久化批准的命令仍返回 ask（设计语义）", () => {
    const pm = new PermissionManager(DEFAULT_RULES);

    // 先通过 approve 持久化一个命令
    pm.approve("bash", "npm *", true); // persistent = true

    // preCheck 不会检查持久化，所以返回 "ask"（默认规则）
    const preResults = pm.preCheck({ permission: "bash", patterns: ["npm install"], tool: "bash" });
    expect(preResults).toHaveLength(1);
    // preCheck 只查会话级规则：approve() 也添加了会话级规则，所以返回 allow
    expect(preResults[0]!.action).toBe("allow");
    expect(preResults[0]!.source).toBe("session-approve");

    pm.destroy();
  });

  test("preCheck 对持久化拒绝的命令仍返回 ask（设计语义）", () => {
    const pm = new PermissionManager(DEFAULT_RULES);

    // 先通过 deny 持久化拒绝一个命令
    pm.deny("bash", "dangerous-cmd", true); // persistent = true

    // preCheck 不查持久化，但 deny() 也添加了会话级规则
    const preResults = pm.preCheck({ permission: "bash", patterns: ["dangerous-cmd"], tool: "bash" });
    expect(preResults).toHaveLength(1);
    expect(preResults[0]!.action).toBe("deny");
    expect(preResults[0]!.source).toBe("session-deny");

    pm.destroy();
  });
});

describe("preCheck — 逐 pattern 独立评估", () => {
  test("混合 allow/deny patterns 各自独立返回正确结果", () => {
    const pm = new PermissionManager(DEFAULT_RULES);

    const results = pm.preCheck({
      permission: "bash",
      patterns: ["echo hello", "dangerous-cmd"],
      tool: "bash",
    });

    expect(results).toHaveLength(2);
    // "echo hello" 没有匹配的 denied/approved 规则，走 default → ask
    expect(results[0]!.action).toBe("ask");
    expect(results[0]!.source).toBe("default");
    // "dangerous-cmd" 同样走 default → ask（没有被会话级拒绝）
    expect(results[1]!.action).toBe("ask");
    expect(results[1]!.source).toBe("default");

    pm.destroy();
  });

  test("已批准的 pattern 返回 allow，未批准的返回 ask", () => {
    const pm = new PermissionManager(DEFAULT_RULES);
    pm.approve("bash", "ls *");

    const results = pm.preCheck({
      permission: "bash",
      patterns: ["ls -la", "npm install"],
      tool: "bash",
    });

    expect(results).toHaveLength(2);
    expect(results[0]!.action).toBe("allow");
    expect(results[0]!.source).toBe("session-approve");
    expect(results[1]!.action).toBe("ask");
    expect(results[1]!.source).toBe("default");

    pm.destroy();
  });
});
