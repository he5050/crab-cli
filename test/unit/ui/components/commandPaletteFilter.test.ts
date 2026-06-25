// @ts-nocheck
/**
 * 命令面板过滤测试。
 *
 * 覆盖导出:
 *   - shouldShowCommandInPalette
 */
import { describe, expect, test } from "bun:test";
import { shouldShowCommandInPalette } from "@/ui/components/commandPalette";

describe("命令面板过滤", () => {
  const makeCmd = (overrides: Partial<{ hidden: boolean; slashName: string; title: string; description: string }>) => ({
    description: "A test command",
    hidden: false,
    id: "test-cmd",
    slashName: "",
    title: "Test Command",
    ...overrides,
  });

  describe("shouldShowCommandInPalette", () => {
    test("非隐藏命令总是显示", () => {
      expect(shouldShowCommandInPalette(makeCmd({ hidden: false }), "")).toBe(true);
      expect(shouldShowCommandInPalette(makeCmd({ hidden: false }), "anything")).toBe(true);
    });

    test("隐藏命令不以 / 开头的查询不显示", () => {
      expect(shouldShowCommandInPalette(makeCmd({ hidden: true, slashName: "test" }), "")).toBe(false);
      expect(shouldShowCommandInPalette(makeCmd({ hidden: true, slashName: "test" }), "test")).toBe(false);
      expect(shouldShowCommandInPalette(makeCmd({ hidden: true, slashName: "test" }), "hello")).toBe(false);
    });

    test("隐藏命令以 / 开头且匹配时显示", () => {
      expect(shouldShowCommandInPalette(makeCmd({ hidden: true, slashName: "help" }), "/help")).toBe(true);
    });

    test("隐藏命令 / 开头但不匹配时不显示", () => {
      expect(shouldShowCommandInPalette(makeCmd({ hidden: true, slashName: "help" }), "/other")).toBe(false);
    });

    test("隐藏命令无 slashName 时以 / 查询不显示", () => {
      expect(shouldShowCommandInPalette(makeCmd({ hidden: true, slashName: "" }), "/test")).toBe(false);
    });

    test("模糊匹配", () => {
      expect(shouldShowCommandInPalette(makeCmd({ hidden: true, slashName: "settings" }), "/set")).toBe(true);
      expect(shouldShowCommandInPalette(makeCmd({ hidden: true, slashName: "settings" }), "/stg")).toBe(true);
    });
  });
});
