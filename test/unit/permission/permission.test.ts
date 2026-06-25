/**
 * 权限管理器测试。
 *
 * 测试用例:
 *   - Allow 规则
 *   - Deny 规则
 *   - Ask 规则
 *   - 通配符匹配
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
  tempDir = createGlobalTmpTestDir("permission-manager-");
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

describe("PermissionManager", () => {
  const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  test("默认 allow 规则直接通过", async () => {
    const pm = new PermissionManager(DEFAULT_RULES);
    const result = await pm.ask({
      patterns: ["/src/main.ts"],
      permission: "fs.read",
      tool: "fs_read",
    });
    expect(result).toBe(true);
  });

  test("默认 deny 规则直接拒绝", async () => {
    const pm = new PermissionManager(DEFAULT_RULES);
    const result = await pm.ask({
      patterns: ["sudo rm -rf /"],
      permission: "bash",
      tool: "bash",
    });
    expect(result).toBe(false);
  });

  test("手动 approve 后同一模式自动通过", async () => {
    const pm = new PermissionManager(DEFAULT_RULES);
    pm.approve("bash", "npm *");
    const result = await pm.ask({
      patterns: ["npm install"],
      permission: "bash",
      tool: "bash",
    });
    expect(result).toBe(true);
  });

  test("手动 deny 后同一模式被拒绝", async () => {
    const pm = new PermissionManager(DEFAULT_RULES);
    pm.deny("bash", "curl *");
    const result = await pm.ask({
      patterns: ["curl http://example.com"],
      permission: "bash",
      tool: "bash",
    });
    expect(result).toBe(false);
  });

  test("getApprovedRules 返回已批准规则", () => {
    const pm = new PermissionManager(DEFAULT_RULES);
    pm.approve("bash", "npm *");
    pm.approve("fs.write", "/src/**");
    const rules = pm.getApprovedRules();
    expect(rules.length).toBe(2);
  });

  test("clearSession 清除非持久规则", () => {
    const pm = new PermissionManager(DEFAULT_RULES);
    pm.approve("bash", "npm *");
    pm.approve("fs.write", "/tmp/**", true); // 持久
    pm.clearSession();
    const rules = pm.getApprovedRules();
    expect(rules.length).toBe(1);
    expect(rules[0]!.pattern).toBe("/tmp/**");
  });

  test("ask 规则触发 PermissionAsked 事件", async () => {
    const pm = new PermissionManager(DEFAULT_RULES);
    const { globalBus } = await import("@/bus/core/eventBus");
    const { AppEvent } = await import("@/bus/events");

    let receivedId = "";
    const unsub = globalBus.subscribe(AppEvent.PermissionAsked, (payload) => {
      receivedId = payload.properties.id;
      // 模拟用户立即允许
      setTimeout(() => pm.reply(payload.properties.id, "once"), 10);
    });

    const result = await pm.ask({
      patterns: ["npm install"],
      permission: "bash",
      tool: "bash",
    });

    unsub();
    expect(receivedId.length).toBeGreaterThan(0);
    expect(receivedId).toMatch(uuidV4Regex);
    expect(result).toBe(true);
  });

  test("用户拒绝后返回 false", async () => {
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
    expect(result).toBe(false);
  });

  test("PermissionResolved 的 always 动作会持久化同类审批", async () => {
    const { globalBus } = await import("@/bus/core/eventBus");
    const { AppEvent } = await import("@/bus/events");

    const firstPm = new PermissionManager(DEFAULT_RULES, "session-a");
    let askCount = 0;
    const firstUnsub = globalBus.subscribe(AppEvent.PermissionAsked, (payload) => {
      askCount += 1;
      setTimeout(() => {
        globalBus.publish(AppEvent.PermissionResolved, {
          action: "always",
          allowed: true,
          id: payload.properties.id,
        });
      }, 10);
    });

    const firstResult = await firstPm.ask({
      patterns: ["npm install crab-cli"],
      permission: "bash",
      tool: "bash",
    });

    firstUnsub();
    firstPm.destroy();

    expect(firstResult).toBe(true);
    expect(askCount).toBe(1);

    const secondPm = new PermissionManager(DEFAULT_RULES, "session-b");
    let secondAskCount = 0;
    const secondUnsub = globalBus.subscribe(AppEvent.PermissionAsked, () => {
      secondAskCount += 1;
    });

    const secondResult = await secondPm.ask({
      patterns: ["npm install crab-cli"],
      permission: "bash",
      tool: "bash",
    });

    secondUnsub();
    secondPm.destroy();

    expect(secondResult).toBe(true);
    expect(secondAskCount).toBe(0);
  });
});
