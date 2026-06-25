/**
 * 权限 Schema 测试。
 *
 * 测试用例:
 *   - PermissionAction 枚举验证
 *   - PermissionRule 结构验证（含 description 和 metadata）
 *   - PermissionRule.pattern 空值拒绝
 *   - PermissionRule.permission 空值拒绝
 *   - PermissionRuleset 规则集验证
 *   - PermissionDecision 枚举验证
 *   - 边界用例与异常场景
 */
import { describe, expect, test } from "bun:test";
import { PermissionAction, PermissionRule, PermissionRuleset, PermissionDecision } from "@/schema/permission";

describe("PermissionAction 枚举", () => {
  test("三种合法动作", () => {
    for (const action of ["allow", "deny", "ask"]) {
      expect(PermissionAction.safeParse(action).success).toBe(true);
    }
  });

  test("拒绝非法动作", () => {
    expect(PermissionAction.safeParse("block").success).toBe(false);
    expect(PermissionAction.safeParse("prompt").success).toBe(false);
    expect(PermissionAction.safeParse("").success).toBe(false);
  });
});

describe("PermissionRule", () => {
  test("最小合法规则（仅必填字段）", () => {
    const rule = { action: "allow", pattern: "/src/.*", permission: "fs.read" };
    expect(PermissionRule.safeParse(rule).success).toBe(true);
  });

  test("合法规则含 description", () => {
    const rule = { action: "allow", description: "允许读取源码", pattern: "/src/.*", permission: "fs.read" };
    expect(PermissionRule.safeParse(rule).success).toBe(true);
  });

  test("合法规则含 metadata", () => {
    const rule = {
      action: "deny",
      metadata: { source: "security-policy", severity: "high" },
      pattern: "/etc/shadow",
      permission: "fs.read",
    };
    expect(PermissionRule.safeParse(rule).success).toBe(true);
  });

  test("合法规则同时含 description 和 metadata", () => {
    const rule = {
      action: "ask",
      description: "写入敏感目录需确认",
      metadata: { risk: "data-loss" },
      pattern: "/data/**",
      permission: "fs.write",
    };
    expect(PermissionRule.safeParse(rule).success).toBe(true);
  });

  test("拒绝缺少 permission（min(1) 约束）", () => {
    const rule = { action: "allow", pattern: "/src/.*", permission: "" };
    expect(PermissionRule.safeParse(rule).success).toBe(false);
  });

  test("拒绝缺少 permission 字段", () => {
    const rule = { action: "allow", pattern: "/src/.*" };
    expect(PermissionRule.safeParse(rule).success).toBe(false);
  });

  test("拒绝缺少 pattern 字段", () => {
    const rule = { action: "allow", permission: "fs.read" };
    expect(PermissionRule.safeParse(rule).success).toBe(false);
  });

  test("拒绝空 pattern（min(1) 约束）", () => {
    const rule = { action: "allow", pattern: "", permission: "fs.read" };
    expect(PermissionRule.safeParse(rule).success).toBe(false);
  });

  test("拒绝缺少 action 字段", () => {
    const rule = { pattern: "/src/.*", permission: "fs.read" };
    expect(PermissionRule.safeParse(rule).success).toBe(false);
  });

  test("拒绝非法 action", () => {
    const rule = { action: "invalid_action", pattern: "/src/.*", permission: "fs.read" };
    expect(PermissionRule.safeParse(rule).success).toBe(false);
  });

  test("parse 后可选字段保留原值", () => {
    const rule = PermissionRule.parse({
      action: "allow",
      description: "描述",
      metadata: { key: "value" },
      pattern: "/src/.*",
      permission: "fs.read",
    });
    expect(rule.description).toBe("描述");
    expect(rule.metadata).toEqual({ key: "value" });
  });

  test("parse 后缺失可选字段为 undefined", () => {
    const rule = PermissionRule.parse({ action: "deny", pattern: "/tmp/.*", permission: "fs.write" });
    expect(rule.description).toBeUndefined();
    expect(rule.metadata).toBeUndefined();
  });
});

describe("PermissionRuleset", () => {
  test("空规则集", () => {
    expect(PermissionRuleset.safeParse([]).success).toBe(true);
  });

  test("多条规则组成规则集", () => {
    const ruleset = [
      { action: "allow", description: "允许读取源码", pattern: "/src/.*", permission: "fs.read" },
      { action: "deny", pattern: "/tmp/.*", permission: "fs.write" },
      { action: "ask", metadata: { confirm: true }, pattern: "/data/**", permission: "fs.write" },
    ];
    expect(PermissionRuleset.safeParse(ruleset).success).toBe(true);
  });

  test("拒绝非数组输入", () => {
    expect(PermissionRuleset.safeParse("allow").success).toBe(false);
    expect(PermissionRuleset.safeParse({}).success).toBe(false);
  });
});

describe("PermissionDecision", () => {
  test("三种合法决策结果", () => {
    for (const decision of ["approved", "denied", "pending"]) {
      expect(PermissionDecision.safeParse(decision).success).toBe(true);
    }
  });

  test("拒绝非法决策结果", () => {
    expect(PermissionDecision.safeParse("allowed").success).toBe(false);
    expect(PermissionDecision.safeParse("rejected").success).toBe(false);
    expect(PermissionDecision.safeParse("").success).toBe(false);
  });
});
