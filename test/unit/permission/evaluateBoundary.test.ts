/**
 * evaluate 边界场景 — 大规模规则集、deny 优先级、多层规则集
 */
import { describe, expect, test } from "bun:test";
import { evaluate, evaluateBatch } from "@/permission/core/evaluate";
import type { PermissionRuleset } from "@/schema/permission";

describe("evaluate — 边界场景", () => {
  test("空规则集返回 ask", () => {
    const result = evaluate("bash", "ls", []);
    expect(result.action).toBe("ask");
    expect(result.rule).toBeNull();
  });

  test("无参数调用返回 ask", () => {
    const result = evaluate("bash", "ls");
    expect(result.action).toBe("ask");
    expect(result.rule).toBeNull();
  });

  test("1000 条规则评估性能 < 50ms", () => {
    const bigRules: PermissionRuleset = Array.from({ length: 1000 }, (_, i) => ({
      action: "deny" as const,
      pattern: `pattern-${i}`,
      permission: "bash",
    }));
    bigRules.push({ action: "allow", pattern: "allowed-cmd", permission: "bash" });

    const start = Date.now();
    const result = evaluate("bash", "allowed-cmd", bigRules);
    expect(Date.now() - start).toBeLessThan(50);
    expect(result.action).toBe("allow");
  });

  test("deny 优先于 allow（同一 ruleset）", () => {
    // 先匹配的规则先生效，git * 先匹配到 allow
    const rules: PermissionRuleset = [
      { action: "allow", pattern: "git *", permission: "bash" },
      { action: "deny", pattern: "git push*", permission: "bash" },
    ];
    expect(evaluate("bash", "git push origin main", rules).action).toBe("allow");

    // 交换顺序后 deny 优先
    const rulesReversed: PermissionRuleset = [
      { action: "deny", pattern: "git push*", permission: "bash" },
      { action: "allow", pattern: "git *", permission: "bash" },
    ];
    expect(evaluate("bash", "git push origin main", rulesReversed).action).toBe("deny");
  });

  test("用户规则覆盖系统规则", () => {
    const userRules: PermissionRuleset = [{ action: "allow", pattern: "sudo *", permission: "bash" }];
    const systemRules: PermissionRuleset = [{ action: "deny", pattern: "sudo *", permission: "bash" }];
    const result = evaluate("bash", "sudo apt install", userRules, systemRules);
    expect(result.action).toBe("allow");
  });

  test("通配符 permission 匹配", () => {
    const rules: PermissionRuleset = [{ action: "deny", pattern: "*", permission: "fs.*" }];
    expect(evaluate("fs.write", "/tmp/test", rules).action).toBe("deny");
  });

  test("空 patterns 列表返回 allow", () => {
    const rules: PermissionRuleset = [{ action: "deny", pattern: "deny-cmd", permission: "bash" }];
    expect(evaluateBatch("bash", [], rules).action).toBe("allow");
  });

  test("多层规则集优先级: 第一层优先", () => {
    const layer1: PermissionRuleset = [{ action: "deny", pattern: "*", permission: "bash" }];
    const layer2: PermissionRuleset = [{ action: "allow", pattern: "*", permission: "bash" }];
    const result = evaluate("bash", "anything", layer1, layer2);
    expect(result.action).toBe("deny");
  });

  test("精确匹配返回匹配到的规则", () => {
    const rules: PermissionRuleset = [
      { action: "allow", pattern: "ls", permission: "bash", description: "list files" },
    ];
    const result = evaluate("bash", "ls", rules);
    expect(result.action).toBe("allow");
    expect(result.rule).not.toBeNull();
    expect(result.rule!.pattern).toBe("ls");
  });
});

describe("evaluateBatch — 边界场景", () => {
  test("单元素 patterns", () => {
    const rules: PermissionRuleset = [{ action: "allow", pattern: "ls", permission: "bash" }];
    expect(evaluateBatch("bash", ["ls"], rules).action).toBe("allow");
  });

  test("大量 patterns 性能", () => {
    const rules: PermissionRuleset = [{ action: "allow", pattern: "*", permission: "bash" }];
    const patterns = Array.from({ length: 1000 }, (_, i) => `cmd-${i}`);
    const start = Date.now();
    const result = evaluateBatch("bash", patterns, rules);
    expect(Date.now() - start).toBeLessThan(100);
    expect(result.action).toBe("allow");
  });

  test("deny 一个即整体 deny", () => {
    const rules: PermissionRuleset = [
      { action: "deny", pattern: "rm *", permission: "bash" },
      { action: "allow", pattern: "*", permission: "bash" },
    ];
    const result = evaluateBatch("bash", ["ls", "rm -rf /", "echo hi"], rules);
    expect(result.action).toBe("deny");
  });

  test("ask 提升为最高非 deny", () => {
    const rules: PermissionRuleset = [{ action: "allow", pattern: "ls", permission: "bash" }];
    const result = evaluateBatch("bash", ["ls", "unknown"], rules);
    expect(result.action).toBe("ask");
  });
});
