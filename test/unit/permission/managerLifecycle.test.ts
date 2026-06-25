/**
 * PermissionManager — 生命周期边界场景测试。
 *
 * 测试用例:
 *   - destroy 后调用 ask() 抛出明确错误
 *   - 重复 destroy 幂等
 *   - AbortSignal 预取消时直接拒绝
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { PermissionManager } from "@/permission/manager/permission";
import type { PermissionRuleset } from "@/schema/permission";
import { closeDb, initDb } from "@/db";
import { clearAllApprovals } from "@/permission/store/approvalStore";
import { cleanupTestDir, createGlobalTmpTestDir } from "../../helpers/testPaths";

const DEFAULT_RULES: PermissionRuleset = [
  { action: "allow", pattern: "**", permission: "fs.read" },
  { action: "allow", pattern: "ls *", permission: "bash" },
  { action: "deny", pattern: "sudo *", permission: "bash" },
  { action: "ask", pattern: "*", permission: "bash" },
];

let tempDir = "";
let originalXdgDataHome: string | undefined;

beforeEach(() => {
  tempDir = createGlobalTmpTestDir("perm-lifecycle-");
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

describe("PermissionManager — 生命周期边界", () => {
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

  test("AbortSignal 预取消时直接拒绝", async () => {
    const controller = new AbortController();
    controller.abort();
    const pm = new PermissionManager(DEFAULT_RULES, "test", undefined, controller.signal);
    const result = await pm.ask({ patterns: ["npm install"], permission: "bash", tool: "bash" });
    expect(result).toBe(false);
    pm.destroy();
  });
});
