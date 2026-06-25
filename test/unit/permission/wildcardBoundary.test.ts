/**
 * wildcardMatch 边界场景测试 — 超长输入、递归限制、Unicode
 */
import { describe, expect, test } from "bun:test";
import { wildcardMatch } from "@/permission/core/wildcard";

describe("wildcardMatch — 递归深度限制", () => {
  test("超深嵌套通配符不会栈溢出", () => {
    // 26个单星号 + 全匹配模式会受深度限制影响提前返回 false
    const deep = "a*b*c*d*e*f*g*h*i*j*k*l*m*n*o*p*q*r*s*t*u*v*w*x*y*z*";
    expect(() => wildcardMatch(deep, "anything")).not.toThrow();
    // 由于 DEFAULT_MAX_DEPTH=50，26个单星号的回溯可能耗尽深度限制
    // 关键是: 不崩溃、不栈溢出
    const result = wildcardMatch(deep, "anything");
    expect(typeof result).toBe("boolean");
  });

  test("适度嵌套通配符正常匹配", () => {
    const moderate = "a*b*c*d*e*";
    expect(wildcardMatch(moderate, "a1b2c3d4e5")).toBe(true);
  });

  test("极深递归超限后返回 false 而非崩溃", () => {
    // 构造需要大量回溯但不匹配的模式
    const pattern = `${"a".repeat(30)}*${"b".repeat(30)}`;
    const input = `${"a".repeat(30)}c${"c".repeat(30)}`;
    // 不匹配且不崩溃
    expect(() => wildcardMatch(pattern, input)).not.toThrow();
    const result = wildcardMatch(pattern, input);
    // 要么因为不匹配返回 false，要么因为深度限制返回 false
    expect(result).toBe(false);
  });

  test(
    "中段双星号匹配受深度限制保护",
    () => {
      const deep = "a/**/b/**/c/**/d/**/e";
      expect(() => wildcardMatch(deep, "a/x/y/b/z/c/w/d/v/e")).not.toThrow();
      expect(wildcardMatch(deep, "a/x/y/b/z/c/w/d/v/e")).toBe(true);
    },
    { timeout: 30_000 },
  );
});

describe("wildcardMatch — Unicode", () => {
  test("中文路径匹配", () => {
    expect(wildcardMatch("src/**/*.ts", "src/组件/主页.ts")).toBe(true);
    expect(wildcardMatch("*.ts", "文件.ts")).toBe(true);
    expect(wildcardMatch("src/**", "src/新建文件夹/测试.ts")).toBe(true);
  });

  test("全角字符不应匹配半角", () => {
    expect(wildcardMatch("＊", "A")).toBe(false);
  });
});

describe("wildcardMatch — 超长输入安全", () => {
  test("超长输入 10000 字符不崩溃", () => {
    const long = "a".repeat(10000);
    expect(wildcardMatch("*", long)).toBe(true);
    expect(wildcardMatch(long, long)).toBe(true);
    expect(wildcardMatch(long, `${long}x`)).toBe(false);
  });

  test("空模式只匹配空串", () => {
    expect(wildcardMatch("", "")).toBe(true);
    expect(wildcardMatch("", "a")).toBe(false);
    expect(wildcardMatch("a", "")).toBe(false);
  });

  test("精确匹配快速路径", () => {
    expect(wildcardMatch("exact", "exact")).toBe(true);
    expect(wildcardMatch("exact", "other")).toBe(false);
  });

  test("模式末尾多个星号", () => {
    expect(wildcardMatch("abc***", "abc")).toBe(true);
    expect(wildcardMatch("abc***", "abcxyz")).toBe(true);
    expect(wildcardMatch("abc***", "ab")).toBe(false);
  });

  test("中段双星号精确匹配", () => {
    expect(wildcardMatch("src/**/index.ts", "src/a/b/c/index.ts")).toBe(true);
    expect(wildcardMatch("src/**/index.ts", "lib/a/index.ts")).toBe(false);
  });
});
