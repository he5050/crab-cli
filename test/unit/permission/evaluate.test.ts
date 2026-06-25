/**
 * 权限评估测试。
 *
 * 测试用例:
 *   - 规则评估
 *   - 冲突解决
 *   - 性能优化
 */
import { describe, expect, test } from "bun:test";
import { evaluate, evaluateBatch } from "@/permission/core/evaluate";
import type { PermissionRuleset } from "@/schema/permission";

const RULES: PermissionRuleset = [
  { action: "allow", pattern: "**", permission: "fs.read" },
  { action: "ask", pattern: "**", permission: "fs.write" },
  { action: "allow", pattern: "ls *", permission: "bash" },
  { action: "allow", pattern: "git *", permission: "bash" },
  { action: "deny", pattern: "sudo *", permission: "bash" },
  { action: "deny", pattern: "rm -rf /*", permission: "bash" },
  { action: "ask", pattern: "*", permission: "bash" },
];

describe("权限评估 — evaluate()", () => {
  test("allow 规则匹配 → 自动通过", () => {
    const result = evaluate("fs.read", "/src/main.ts", RULES);
    expect(result.action).toBe("allow");
    expect(result.rule).toBeDefined();
  });

  test("deny 规则匹配 → 自动拒绝", () => {
    const result = evaluate("bash", "sudo rm -rf /", RULES);
    expect(result.action).toBe("deny");
  });

  test("ask 规则匹配 → 需确认", () => {
    const result = evaluate("fs.write", "/src/main.ts", RULES);
    expect(result.action).toBe("ask");
  });

  test("无匹配规则 → 默认 ask", () => {
    const result = evaluate("unknown.tool", "any", RULES);
    expect(result.action).toBe("ask");
    expect(result.rule).toBeNull();
  });

  test("多规则优先级(第一个匹配生效)", () => {
    // Ls 在 "ls *" 之前匹配到 "ask" 不会发生，因为 "ls *" 先出现
    const result = evaluate("bash", "ls -la", RULES);
    expect(result.action).toBe("allow");
  });

  test("sudo 被 deny 拦截", () => {
    const result = evaluate("bash", "sudo apt install", RULES);
    expect(result.action).toBe("deny");
  });

  test("普通 bash 命令需确认", () => {
    const result = evaluate("bash", "npm install", RULES);
    expect(result.action).toBe("ask");
  });

  test("多层规则集", () => {
    const userRules: PermissionRuleset = [{ action: "allow", pattern: "npm *", permission: "bash" }];
    const result = evaluate("bash", "npm install", userRules, RULES);
    expect(result.action).toBe("allow");
    // 用户规则优先
    expect(result.rule!.pattern).toBe("npm *");
  });

  test("通配符 permission 匹配", () => {
    const rules: PermissionRuleset = [{ action: "allow", pattern: "**", permission: "fs.*" }];
    expect(evaluate("fs.read", "/a", rules).action).toBe("allow");
    expect(evaluate("fs.write", "/a", rules).action).toBe("allow");
  });
});

describe("批量评估 — evaluateBatch()", () => {
  test("全部 allow → allow", () => {
    const result = evaluateBatch("fs.read", ["/a.ts", "/b.ts"], RULES);
    expect(result.action).toBe("allow");
  });

  test("包含 deny → deny", () => {
    const result = evaluateBatch("bash", ["ls", "sudo rm -rf /"], RULES);
    expect(result.action).toBe("deny");
  });

  test("包含 ask → ask", () => {
    const result = evaluateBatch("bash", ["ls", "npm install"], RULES);
    expect(result.action).toBe("ask");
  });

  test("空 patterns → allow", () => {
    const result = evaluateBatch("bash", [], RULES);
    expect(result.action).toBe("allow");
  });
});
