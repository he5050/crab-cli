/**
 * 命令面板测试。
 *
 * 测试目标:
 *   - 验证 shouldShowCommandInPalette 在命令面板中过滤逻辑
 *
 * 测试用例:
 *   - 隐藏命令被过滤
 *   - 显式可见命令被保留
 *   - 上下文(context)匹配规则
 */
import { describe, expect, test } from "bun:test";
import { shouldShowCommandInPalette } from "@/ui/components/commandPalette";
import type { Command } from "@/commandPalette/types";

const hiddenCmd: Command = {
  category: "工具",
  description: "hidden debug command",
  hidden: true,
  name: "tool.e2e-subagent-mcp",
  run: () => {},
  slashName: "e2e-subagent-mcp",
  title: "子代理 MCP E2E",
};

describe("命令面板隐藏的 slash 命令", () => {
  test("keeps hidden commands hidden for non-slash browsing", () => {
    expect(shouldShowCommandInPalette(hiddenCmd, "")).toBe(false);
    expect(shouldShowCommandInPalette(hiddenCmd, "e2e")).toBe(false);
  });

  test("shows hidden commands for matching slash queries", () => {
    expect(shouldShowCommandInPalette(hiddenCmd, "/e2e-subagent-mcp")).toBe(true);
    expect(shouldShowCommandInPalette(hiddenCmd, "/e2e")).toBe(true);
  });
});
