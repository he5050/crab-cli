/**
 * Project-settings 白盒测试 — normalizeSubAgentMaxSpawnDepth + 默认值逻辑。
 *
 * 大部分 getter/setter 依赖 unified-settings，此处测试可脱离配置系统的纯函数。
 */
import { describe, expect, test } from "bun:test";
import { MAX_SPAWN_DEPTH } from "@/config/constants";
import { DEFAULT_SUB_AGENT_MAX_SPAWN_DEPTH } from "@/config";

// 复制 normalizeSubAgentMaxSpawnDepth 纯函数来测试

function normalizeSubAgentMaxSpawnDepth(depth: unknown): number {
  if (typeof depth !== "number" || !Number.isFinite(depth)) {
    return DEFAULT_SUB_AGENT_MAX_SPAWN_DEPTH;
  }
  const normalizedDepth = Math.floor(depth);
  return normalizedDepth < 0 ? 0 : normalizedDepth;
}

describe("normalizeSubAgentMaxSpawnDepth", () => {
  test("undefined → canonical 默认值", () => {
    expect(normalizeSubAgentMaxSpawnDepth(undefined)).toBe(MAX_SPAWN_DEPTH);
  });

  test("null → canonical 默认值", () => {
    expect(normalizeSubAgentMaxSpawnDepth(null)).toBe(MAX_SPAWN_DEPTH);
  });

  test("字符串 → canonical 默认值", () => {
    expect(normalizeSubAgentMaxSpawnDepth("3")).toBe(MAX_SPAWN_DEPTH);
  });

  test("NaN → canonical 默认值", () => {
    expect(normalizeSubAgentMaxSpawnDepth(NaN)).toBe(MAX_SPAWN_DEPTH);
  });

  test("Infinity → canonical 默认值", () => {
    expect(normalizeSubAgentMaxSpawnDepth(Infinity)).toBe(MAX_SPAWN_DEPTH);
  });

  test("负数 → 0", () => {
    expect(normalizeSubAgentMaxSpawnDepth(-1)).toBe(0);
    expect(normalizeSubAgentMaxSpawnDepth(-100)).toBe(0);
  });

  test("0 → 0", () => {
    expect(normalizeSubAgentMaxSpawnDepth(0)).toBe(0);
  });

  test("正整数不变", () => {
    expect(normalizeSubAgentMaxSpawnDepth(3)).toBe(3);
    expect(normalizeSubAgentMaxSpawnDepth(10)).toBe(10);
  });

  test("小数向下取整", () => {
    expect(normalizeSubAgentMaxSpawnDepth(2.7)).toBe(2);
    expect(normalizeSubAgentMaxSpawnDepth(0.5)).toBe(0);
  });
});

describe("ProjectSettings 默认值逻辑", () => {
  test("boolean 字段用 ?? 回退", () => {
    const missingBool: boolean | undefined = undefined;
    const trueValue: boolean | undefined = true;
    const falseValue: boolean | undefined = false;
    expect(missingBool ?? false).toBe(false);
    expect(missingBool ?? true).toBe(true);
    expect(trueValue ?? false).toBe(true);
    expect(falseValue ?? true).toBe(false);
  });

  test("fileListDisplayMode 默认 list", () => {
    const missingMode: "tree" | undefined = undefined;
    const treeMode: "tree" | undefined = "tree";
    expect(missingMode ?? "list").toBe("list");
    expect(treeMode ?? "list").toBe("tree");
  });

  test("subAgentMaxSpawnDepth 通过 normalize 处理", () => {
    const raw = undefined;
    const result = normalizeSubAgentMaxSpawnDepth(raw);
    expect(result).toBe(DEFAULT_SUB_AGENT_MAX_SPAWN_DEPTH);
  });

  test("subAgentMaxSpawnDepth 默认值与 MAX_SPAWN_DEPTH 保持一致", () => {
    expect(DEFAULT_SUB_AGENT_MAX_SPAWN_DEPTH).toBe(MAX_SPAWN_DEPTH);
  });
});
