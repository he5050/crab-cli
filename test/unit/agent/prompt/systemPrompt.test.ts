/**
 * 系统提示词内容验证 — 验证各种场景下的完整提示词结构。
 *
 * 测试用例:
 *   - 包含基础提示词内容
 *   - 包含工具使用说明
 *   - 包含环境上下文
 *   - 提示词段落顺序正确
 *   - 包含代码搜索策略
 *   - 包含平台命令段
 */
import { describe, expect, test } from "bun:test";
import { buildSystemPrompt } from "@/agent/prompt/builder";

describe("系统提示词内容验证", () => {
  const basePrompt = "# 编程助手\n你是一个专业的编程助手。";

  test("包含基础提示词内容", () => {
    const result = buildSystemPrompt({
      basePrompt,
      includeInstructions: false,
      mode: "chat",
    });
    expect(result).toContain("# 编程助手");
    expect(result).toContain("你是一个专业的编程助手。");
  });

  test("包含工具使用说明", () => {
    const result = buildSystemPrompt({
      basePrompt,
      includeInstructions: false,
      includePlatformCommands: false,
      includeToolUsage: true,
      mode: "chat",
    });
    expect(result).toContain("## 工具使用说明");
    expect(result).toContain("文件操作");
    expect(result).toContain("搜索工具");
    expect(result).toContain("终端工具");
    expect(result).toContain("代码搜索策略");
  });

  test("包含环境上下文", () => {
    const result = buildSystemPrompt({
      basePrompt,
      environment: {
        cwd: "/home/user/project",
        date: "2026-05-21",
        isGitRepo: true,
        modelId: "anthropic/claude-sonnet-4",
        platform: "darwin",
        projectRoot: "/home/user",
        shell: "zsh",
      },
      includeInstructions: false,
      mode: "chat",
    });
    expect(result).toContain("Working directory: /home/user/project");
    expect(result).toContain("Project root: /home/user");
    expect(result).toContain("Is directory a git repo: yes");
    expect(result).toContain("Platform: macOS");
    expect(result).toContain("Today's date: 2026-05-21");
    expect(result).toContain("Shell: zsh");
    expect(result).toContain("Model: anthropic/claude-sonnet-4");
  });

  test("提示词段落顺序:基础 → 模式 → 平台 → 工具 → 环境", () => {
    const result = buildSystemPrompt({
      basePrompt: "# BASE",
      environment: { cwd: "/test" },
      includeInstructions: false,
      includePlatformCommands: true,
      includeToolUsage: true,
      mode: "plan",
    });
    const baseIdx = result.indexOf("# BASE");
    const planIdx = result.indexOf("Plan 模式规则");
    const platformIdx = result.indexOf("平台命令说明");
    const toolIdx = result.indexOf("## 工具使用说明");
    const envIdx = result.indexOf("<env>");

    expect(baseIdx).toBeLessThan(planIdx);
    expect(planIdx).toBeLessThan(platformIdx);
    expect(platformIdx).toBeLessThan(toolIdx);
    expect(toolIdx).toBeLessThan(envIdx);
  });

  test("YOLO 叠加的提示词包含双重模式指令", () => {
    const result = buildSystemPrompt({
      basePrompt,
      environment: { cwd: "/test" },
      includeInstructions: false,
      mode: "plan",
      yoloOverlay: true,
    });
    expect(result).toContain("Plan 模式规则");
    expect(result).toContain("YOLO 模式规则");
  });

  test("自定义追加内容存在", () => {
    const custom = "## 用户规则\n只回答 Go 语言问题。";
    const result = buildSystemPrompt({
      basePrompt,
      customAppend: custom,
      environment: { cwd: "/test" },
      includeInstructions: false,
      mode: "chat",
    });
    expect(result).toContain("## 用户规则");
    expect(result).toContain("只回答 Go 语言问题。");
  });
});
