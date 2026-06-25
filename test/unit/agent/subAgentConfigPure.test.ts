/**
 * Sub-agent-config 白盒测试 — 纯函数:validateSubAgent。
 */
import { describe, expect, test } from "bun:test";
import { validateSubAgent } from "@/config";

describe("validateSubAgent", () => {
  test("空名称报错", () => {
    const errors = validateSubAgent({ description: "test", name: "", tools: ["bash"] });
    expect(errors).toContain("Agent 名称不能为空");
  });

  test("名称过长报错", () => {
    const errors = validateSubAgent({ description: "d", name: "a".repeat(101), tools: ["bash"] });
    expect(errors).toContain("Agent 名称不能超过 100 个字符");
  });

  test("无工具报错", () => {
    const errors = validateSubAgent({ description: "d", name: "test", tools: [] });
    expect(errors).toContain("至少需要选择一个工具");
  });

  test("描述过长报错", () => {
    const errors = validateSubAgent({ description: "d".repeat(501), name: "test", tools: ["bash"] });
    expect(errors).toContain("描述不能超过 500 个字符");
  });

  test("有效数据无错误", () => {
    const errors = validateSubAgent({ description: "a test agent", name: "test", tools: ["bash"] });
    expect(errors).toEqual([]);
  });

  test("多个错误同时返回", () => {
    const errors = validateSubAgent({ description: "d".repeat(501), name: "", tools: [] });
    expect(errors.length).toBeGreaterThanOrEqual(3);
  });
});
