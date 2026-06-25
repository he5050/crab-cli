/**
 * src/tool/registry 纯函数单元测试
 *
 * 测试范围:
 *   - normalizeToolRef: 工具引用规范化 (来自 toolRefUtils.ts)
 *   - toolNameMatches: 工具名称白名单匹配 (来自 toolNameMatcher.ts)
 *
 * 策略: 仅测试无外部依赖的纯函数，避免 mock.module 深层传递问题。
 *       toolRegistry.ts 的 CRUD 测试需要完整的依赖注入环境，不适合单元测试。
 */
import { describe, it, expect } from "bun:test";

import { normalizeToolRef } from "@/tool/registry/toolRefUtils";
import { toolNameMatches } from "@/tool/registry/toolNameMatcher";

// ═══════════════════════════════════════════════════════════════════
// normalizeToolRef (toolRefUtils.ts)
// ═══════════════════════════════════════════════════════════════════
describe("normalizeToolRef", () => {
  it("应去除首尾空白并转小写", () => {
    expect(normalizeToolRef("  Hello  ")).toBe("hello");
  });

  it("应将冒号转为下划线", () => {
    expect(normalizeToolRef("server:mytool")).toBe("server_mytool");
  });

  it("应将连字符转为下划线", () => {
    expect(normalizeToolRef("my-tool")).toBe("my_tool");
  });

  it("应将空格转为下划线", () => {
    expect(normalizeToolRef("my tool")).toBe("my_tool");
  });

  it("应合并连续下划线", () => {
    expect(normalizeToolRef("a--b__c")).toBe("a_b_c");
  });

  it("应处理混合分隔符", () => {
    expect(normalizeToolRef("A:B-C D")).toBe("a_b_c_d");
  });

  it("空字符串应返回空字符串", () => {
    expect(normalizeToolRef("")).toBe("");
  });

  it("纯数字应保持不变", () => {
    expect(normalizeToolRef("123")).toBe("123");
  });

  it("已有下划线不变", () => {
    expect(normalizeToolRef("my_tool")).toBe("my_tool");
  });
});

// ═══════════════════════════════════════════════════════════════════
// toolNameMatches (toolNameMatcher.ts)
// ═══════════════════════════════════════════════════════════════════
describe("toolNameMatches", () => {
  // 通配符: "*" 匹配所有
  it("通配符 * 应匹配任意工具名", () => {
    expect(toolNameMatches("anything", "*")).toBe(true);
    expect(toolNameMatches("foo-bar", "*")).toBe(true);
  });

  // 精确匹配: 名称完全相同
  it("应精确匹配工具名", () => {
    expect(toolNameMatches("filesystem-read", "filesystem-read")).toBe(true);
  });

  // 下划线/连字符兼容
  it("下划线和连字符应视为等价", () => {
    expect(toolNameMatches("filesystem_read", "filesystem-read")).toBe(true);
  });

  // 前缀匹配
  it("前缀匹配: filesystem- 应匹配 filesystem-read", () => {
    expect(toolNameMatches("filesystem-read", "filesystem-")).toBe(true);
  });

  it("前缀匹配: filesystem- 应匹配 filesystem-write", () => {
    expect(toolNameMatches("filesystem-write", "filesystem-")).toBe(true);
  });

  // 后缀匹配(外部工具)
  it("后缀匹配: 外部工具 mytool 应匹配 server-mytool", () => {
    expect(toolNameMatches("server-mytool", "mytool")).toBe(true);
  });

  // 后缀匹配(MCP 风格)
  it("后缀匹配: MCP 工具 create_issue 应匹配 github_create_issue", () => {
    expect(toolNameMatches("github_create_issue", "create_issue")).toBe(true);
  });

  // 不匹配
  it("不匹配: 完全不同的名称应返回 false", () => {
    expect(toolNameMatches("filesystem-read", "websearch")).toBe(false);
  });

  it("不匹配: 部分前缀不应导致误匹配", () => {
    expect(toolNameMatches("filesystem-read", "file")).toBe(false);
  });

  // 空字符串
  it("空字符串不应匹配", () => {
    expect(toolNameMatches("", "")).toBe(true); // 精确匹配
    expect(toolNameMatches("tool", "")).toBe(false);
  });
});
