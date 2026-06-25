/**
 * builtinToolPrefixes 动态注册机制单元测试
 *
 * 测试范围:
 *   - registerBuiltinPrefix: 前缀提取与注册
 *   - getBuiltinPrefixes: 返回只读集合
 *   - 向后兼容: 静态种子前缀存在
 *   - 边界: 无分隔符工具名、重复注册幂等
 */
import { describe, expect, it, beforeEach } from "bun:test";

import { registerBuiltinPrefix, getBuiltinPrefixes } from "@/tool/registry/builtinToolPrefixes";

describe("builtinToolPrefixes", () => {
  beforeEach(() => {
    // 测试间需要清理动态注册的前缀
    // 注意: 静态种子前缀无法移除（Set），只测试增量行为
  });

  it("静态种子前缀应存在", () => {
    // 种子中已知的前缀（如 "filesystem-", "todo-"）应始终存在
    expect(getBuiltinPrefixes().has("filesystem-")).toBe(true);
    expect(getBuiltinPrefixes().has("todo-")).toBe(true);
    expect(getBuiltinPrefixes().has("websearch-")).toBe(true);
    expect(getBuiltinPrefixes().has("bash")).toBe(false); // "bash" 无分隔符，不注册
  });

  it("registerBuiltinPrefix 应提取 'tool-group-' 前缀", () => {
    registerBuiltinPrefix("filesystem-read");
    expect(getBuiltinPrefixes().has("filesystem-")).toBe(true);
  });

  it("registerBuiltinPrefix 应提取 '_' 分隔前缀", () => {
    registerBuiltinPrefix("skill_deploy");
    expect(getBuiltinPrefixes().has("skill_")).toBe(true);
  });

  it("无分隔符工具名不应注册", () => {
    registerBuiltinPrefix("bash");
    registerBuiltinPrefix("git");
    // 无变化 — 这些本身就不存在
    expect(getBuiltinPrefixes().has("bash")).toBe(false);
    expect(getBuiltinPrefixes().has("git")).toBe(false);
  });

  it("重复注册应幂等", () => {
    const before = getBuiltinPrefixes().size;
    registerBuiltinPrefix("filesystem-read");
    registerBuiltinPrefix("filesystem-read");
    registerBuiltinPrefix("filesystem-read");
    expect(getBuiltinPrefixes().size).toBe(before); // 无新增
  });

  it("多段工具名应取第一个分隔符前", () => {
    registerBuiltinPrefix("my-custom-tool");
    expect(getBuiltinPrefixes().has("my-")).toBe(true);
    expect(getBuiltinPrefixes().has("my-custom-")).toBe(false);
  });

  it("getBuiltinPrefixes 应返回同一引用", () => {
    const a = getBuiltinPrefixes();
    const b = getBuiltinPrefixes();
    expect(a).toBe(b); // 同一个 Set 引用
  });

  it("动态注册后可通过 getBuiltinPrefixes 查询", () => {
    registerBuiltinPrefix("newlib-query");
    expect(getBuiltinPrefixes().has("newlib-")).toBe(true);
  });
});
