/**
 * Unicode / NFC 归一化测试 — 通配符匹配引擎对非 ASCII 字符的处理
 */
import { describe, expect, test } from "bun:test";
import { wildcardMatch } from "@/permission/core/wildcard";

describe("wildcardMatch — Unicode 支持", () => {
  test("中文字符精确匹配", () => {
    expect(wildcardMatch("测试", "测试")).toBe(true);
  });

  test("中文路径通配符匹配", () => {
    expect(wildcardMatch("src/*.ts", "src/组件.ts")).toBe(true);
    expect(wildcardMatch("src/**/*.ts", "src/组件/子模块.ts")).toBe(true);
  });

  test("中文模式匹配中文输入", () => {
    expect(wildcardMatch("删除*", "删除文件")).toBe(true);
    expect(wildcardMatch("删除*", "删除")).toBe(true);
  });

  test("英文模式不匹配中文输入", () => {
    expect(wildcardMatch("delete*", "删除")).toBe(false);
  });

  test("混合中英文路径", () => {
    expect(wildcardMatch("src/工具/*.ts", "src/工具/index.ts")).toBe(true);
  });

  test("问号匹配单个中文字符", () => {
    expect(wildcardMatch("文件?", "文件A")).toBe(true);
    expect(wildcardMatch("文件?", "文件")).toBe(false);
  });

  test("字符集匹配中文", () => {
    expect(wildcardMatch("[是否]", "是")).toBe(true);
    expect(wildcardMatch("[是否]", "否")).toBe(true); // 否在字符集中
    expect(wildcardMatch("[是否]", "和")).toBe(false); // 和不在字符集中
  });
});

describe("wildcardMatch — 特殊字符处理", () => {
  test("空字符串模式只匹配空输入", () => {
    expect(wildcardMatch("", "")).toBe(true);
    expect(wildcardMatch("", "anything")).toBe(false);
  });

  test("星号模式匹配空输入", () => {
    expect(wildcardMatch("*", "")).toBe(true);
    expect(wildcardMatch("**", "")).toBe(true);
  });

  test("路径分隔符处理", () => {
    // 当前实现: * 跨分隔符（CLI 命令匹配语义）
    expect(wildcardMatch("src/*", "src/foo/bar.ts")).toBe(true);
    expect(wildcardMatch("src/**", "src/foo/bar.ts")).toBe(true);
  });

  test("反斜杠路径", () => {
    expect(wildcardMatch(String.raw`src\*`, String.raw`src\foo`)).toBe(true);
  });
});
