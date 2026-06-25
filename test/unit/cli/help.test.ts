/**
 * CLI 帮助模块单元测试
 *
 * 测试重点:
 *   - getHelpText 包含所有关键命令和选项
 *   - printHelp 正确输出到 stdout
 *   - 版本号正确嵌入帮助文本
 */
import { describe, expect, test } from "bun:test";
import { getHelpText, printHelp } from "@/cli/help";

describe("getHelpText", () => {
  const version = "1.2.3";

  test("includes version number", () => {
    const helpText = getHelpText(version);
    expect(helpText).toContain(`v${version}`);
  });

  test("includes usage section", () => {
    const helpText = getHelpText(version);
    expect(helpText).toContain("用法:");
  });

  test("includes options section", () => {
    const helpText = getHelpText(version);
    expect(helpText).toContain("选项:");
  });

  test("includes core commands", () => {
    const helpText = getHelpText(version);
    expect(helpText).toContain("crab setup");
    expect(helpText).toContain("crab config test");
    expect(helpText).toContain("crab --ask");
    expect(helpText).toContain("crab --sse");
    expect(helpText).toContain("crab --acp");
    expect(helpText).toContain("crab --task");
  });

  test("includes SSE related commands", () => {
    const helpText = getHelpText(version);
    expect(helpText).toContain("--sse-daemon");
    expect(helpText).toContain("--sse-stop");
    expect(helpText).toContain("--sse-status");
  });

  test("includes task management commands", () => {
    const helpText = getHelpText(version);
    expect(helpText).toContain("--task");
    expect(helpText).toContain("--task-list");
    expect(helpText).toContain("--task-status");
  });

  test("includes mode flags", () => {
    const helpText = getHelpText(version);
    expect(helpText).toContain("--yolo");
    expect(helpText).toContain("--c-yolo");
    expect(helpText).toContain("--plan");
  });

  test("includes utility commands", () => {
    const helpText = getHelpText(version);
    expect(helpText).toContain("--help");
    expect(helpText).toContain("--version");
    expect(helpText).toContain("--update");
  });

  test("includes configuration export/import", () => {
    const helpText = getHelpText(version);
    expect(helpText).toContain("config export");
    expect(helpText).toContain("config import");
  });

  test("includes continue session option", () => {
    const helpText = getHelpText(version);
    expect(helpText).toContain("--continue");
  });

  test("includes work directory option", () => {
    const helpText = getHelpText(version);
    expect(helpText).toContain("--work-dir");
  });

  test("includes MCP control option", () => {
    const helpText = getHelpText(version);
    expect(helpText).toContain("--no-mcp");
  });
});

describe("printHelp", () => {
  test("outputs help text to stdout", () => {
    const originalLog = console.log;
    const captured: string[] = [];
    console.log = ((...args: any[]) => {
      captured.push(args.join(" "));
    }) as typeof console.log;

    try {
      printHelp("2.0.0");
      const output = captured.join("\n");
      expect(output).toContain("v2.0.0");
      expect(output).toContain("用法:");
    } finally {
      console.log = originalLog;
    }
  });
});
