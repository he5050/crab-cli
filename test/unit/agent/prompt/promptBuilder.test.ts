/**
 * 提示词构建器测试 — 覆盖所有构建路径和输出验证。
 *
 * 测试用例:
 *   - 默认模式提示词包含环境上下文(cwd)
 *   - Plan 模式包含计划指令
 *   - Team 模式包含团队指令
 *   - YOLO 模式包含自动执行指令
 *   - YOLO 叠加在 chat 模式之上
 *   - Simple 模式包含简单规则
 *   - Security 模式包含安全审计指令
 *   - 自定义提示词追加到末尾
 *   - 不包含工具说明选项
 *   - 空基础提示词仍可构建
 *   - 平台命令段
 *   - 环境上下文包含模型信息
 *   - 环境上下文包含 Shell 信息
 *   - 模型感知基础提示词
 *   - 动态 system-reminder
 *   - Token 预算约束
 *   - 工具 schema 注入
 *   - Plan 回滚策略
 *   - Team worktree 隔离
 */
import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildDynamicReminder,
  buildSystemPrompt,
  buildSystemPromptAsync,
  getModeInstruction,
  isAutoApproveMode,
  isReadOnlyMode,
  previewSystemPrompt,
  selectBasePromptByModel,
} from "@/agent/prompt/builder";
import { clearInstructionCache } from "@/agent/prompt/context";

describe("提示词构建器", () => {
  const basePrompt = "# 测试助手\n你是一个测试助手。";

  afterEach(() => {
    clearInstructionCache();
  });

  describe("buildSystemPrompt", () => {
    test("默认模式包含基础提示词", () => {
      const result = buildSystemPrompt({
        basePrompt,
        environment: { cwd: "/test/project" },
        mode: "chat",
      });
      expect(result).toContain("# 测试助手");
      expect(result).toContain("你是一个测试助手。");
    });

    test("默认模式提示词包含环境上下文 cwd", () => {
      const result = buildSystemPrompt({
        basePrompt,
        environment: { cwd: "/test/project" },
        mode: "chat",
      });
      expect(result).toContain("Working directory: /test/project");
      expect(result).toContain("<env>");
      expect(result).toContain("</env>");
    });

    test("工具说明包含 Ultra Todo 阶段闭环策略", () => {
      const result = buildSystemPrompt({
        basePrompt,
        environment: { cwd: "/test/project" },
        mode: "chat",
      });
      expect(result).toContain("Ultra Todo 阶段闭环策略");
      expect(result).toContain("todo-ultra complete_phase");
      expect(result).toContain("todo-ultra advance_phase");
      expect(result).toContain("parentId 子任务语义");
    });

    test("Plan 模式包含计划指令", () => {
      const result = buildSystemPrompt({
        basePrompt,
        environment: { cwd: "/test" },
        mode: "plan",
      });
      expect(result).toContain("Plan 模式规则");
      expect(result).toContain("只做分析和规划");
    });

    test("Plan 模式包含 5 阶段工作流", () => {
      const result = buildSystemPrompt({
        basePrompt,
        environment: { cwd: "/test" },
        mode: "plan",
      });
      expect(result).toContain("阶段 1");
      expect(result).toContain("阶段 2");
      expect(result).toContain("阶段 3");
      expect(result).toContain("阶段 4");
      expect(result).toContain("阶段 5");
    });

    test("Plan 模式包含计划文档模板", () => {
      const result = buildSystemPrompt({
        basePrompt,
        environment: { cwd: "/test" },
        includeInstructions: false,
        mode: "plan",
      });
      expect(result).toContain("背景");
      expect(result).toContain("影响分析");
      expect(result).toContain("步骤");
      expect(result).toContain("风险和缓解");
      expect(result).toContain("验证方式");
    });

    test("Plan 模式包含回滚策略 (I1)", () => {
      const result = buildSystemPrompt({
        basePrompt,
        environment: { cwd: "/test" },
        includeInstructions: false,
        mode: "plan",
      });
      expect(result).toContain("回滚策略");
      expect(result).toContain("回滚点");
      expect(result).toContain("回退方案");
    });

    test("Team 模式包含团队指令", () => {
      const result = buildSystemPrompt({
        basePrompt,
        environment: { cwd: "/test" },
        mode: "team",
      });
      expect(result).toContain("Team 模式规则");
      expect(result).toContain("协调者");
    });

    test("Team 模式包含强制要求", () => {
      const result = buildSystemPrompt({
        basePrompt,
        environment: { cwd: "/test" },
        mode: "team",
      });
      expect(result).toContain("强制要求");
      expect(result).toContain("队友");
    });

    test("Team 模式包含工作流模板", () => {
      const result = buildSystemPrompt({
        basePrompt,
        environment: { cwd: "/test" },
        mode: "team",
      });
      expect(result).toContain("分解任务");
      expect(result).toContain("创建队友");
      expect(result).toContain("合并");
      expect(result).toContain("综合汇报");
      expect(result).toContain("清理");
    });

    test("Team 模式包含 team 工具说明", () => {
      const result = buildSystemPrompt({
        basePrompt,
        environment: { cwd: "/test" },
        mode: "team",
      });
      expect(result).toContain("team-spawn");
      expect(result).toContain("team-merge-all");
      expect(result).toContain("team-cleanup");
    });

    test("YOLO 模式包含自动执行指令", () => {
      const result = buildSystemPrompt({
        basePrompt,
        environment: { cwd: "/test" },
        mode: "yolo",
      });
      expect(result).toContain("YOLO 模式规则");
      expect(result).toContain("自动执行");
    });

    test("YOLO 叠加在 chat 模式之上", () => {
      const result = buildSystemPrompt({
        basePrompt,
        environment: { cwd: "/test" },
        mode: "chat",
        yoloOverlay: true,
      });
      expect(result).toContain("对话模式规则");
      expect(result).toContain("YOLO 模式规则");
      expect(result).toContain("自动执行");
    });

    test("Simple 模式包含简单规则 (N4)", () => {
      const result = buildSystemPrompt({
        basePrompt,
        environment: { cwd: "/test" },
        includeInstructions: false,
        mode: "simple",
      });
      expect(result).toContain("Simple 模式规则");
      expect(result).toContain("纯文本对话");
      expect(result).toContain("不调用任何工具");
    });

    test("Security 模式包含安全审计指令 (N4)", () => {
      const result = buildSystemPrompt({
        basePrompt,
        environment: { cwd: "/test" },
        includeInstructions: false,
        mode: "security",
      });
      expect(result).toContain("Security 审计模式规则");
      expect(result).toContain("安全漏洞");
      expect(result).toContain("Critical");
    });

    test("自定义提示词追加到末尾", () => {
      const custom = "## 自定义规则\n只回答 Python 相关问题。";
      const result = buildSystemPrompt({
        basePrompt,
        customAppend: custom,
        mode: "chat",
      });
      expect(result).toContain("自定义规则");
      expect(result).toContain("只回答 Python 相关问题。");
    });

    test("不包含工具说明选项", () => {
      const result = buildSystemPrompt({
        basePrompt,
        includeInstructions: false,
        includePlatformCommands: false,
        includeToolUsage: false,
        mode: "chat",
      });
      expect(result).not.toContain("工具使用说明");
    });

    test("包含工具说明选项", () => {
      const result = buildSystemPrompt({
        basePrompt,
        includeInstructions: false,
        includePlatformCommands: false,
        includeToolUsage: true,
        mode: "chat",
      });
      expect(result).toContain("工具使用说明");
    });

    test("工具说明包含 Skill 使用策略", () => {
      const result = buildSystemPrompt({
        basePrompt,
        includeInstructions: false,
        includePlatformCommands: false,
        includeToolUsage: true,
        mode: "chat",
      });
      expect(result).toContain("Skill 使用策略");
      expect(result).toContain("skills recommend");
      expect(result).toContain("skills search");
      expect(result).toContain("matchScore");
      expect(result).toContain("recommendedOrder");
      expect(result).toContain("recommendedAction");
      expect(result).toContain("plan -> analyze -> implement -> verify -> document -> operate");
    });

    test("空基础提示词仍可构建", () => {
      const result = buildSystemPrompt({
        basePrompt: "",
        environment: { cwd: "/test" },
        includeInstructions: false,
        mode: "chat",
      });
      expect(result).toContain("Working directory: /test");
      expect(result).toContain("对话模式规则");
    });

    test("环境上下文包含平台信息", () => {
      const result = buildSystemPrompt({
        basePrompt,
        environment: { cwd: "/test", platform: "linux" },
        includeInstructions: false,
        mode: "chat",
      });
      expect(result).toContain("Platform: Linux");
    });

    test("环境上下文包含 Git 信息", () => {
      const result = buildSystemPrompt({
        basePrompt,
        environment: { cwd: "/test", isGitRepo: true },
        includeInstructions: false,
        mode: "chat",
      });
      expect(result).toContain("Is directory a git repo: yes");
    });

    test("环境上下文包含项目根目录", () => {
      const result = buildSystemPrompt({
        basePrompt,
        environment: { cwd: "/test", projectRoot: "/root" },
        includeInstructions: false,
        mode: "chat",
      });
      expect(result).toContain("Project root: /root");
    });

    test("环境上下文包含日期", () => {
      const result = buildSystemPrompt({
        basePrompt,
        environment: { cwd: "/test", date: "2026-01-15" },
        includeInstructions: false,
        mode: "chat",
      });
      expect(result).toContain("Today's date: 2026-01-15");
    });

    test("环境上下文包含模型 ID", () => {
      const result = buildSystemPrompt({
        basePrompt,
        environment: { cwd: "/test", modelId: "anthropic/claude-sonnet-4" },
        includeInstructions: false,
        mode: "chat",
      });
      expect(result).toContain("Model: anthropic/claude-sonnet-4");
    });

    test("环境上下文包含 Shell 信息", () => {
      const result = buildSystemPrompt({
        basePrompt,
        environment: { cwd: "/test", shell: "zsh" },
        includeInstructions: false,
        mode: "chat",
      });
      expect(result).toContain("Shell: zsh");
    });

    test("包含平台命令段", () => {
      const result = buildSystemPrompt({
        basePrompt,
        environment: { cwd: "/test", platform: "darwin" },
        includeInstructions: false,
        includePlatformCommands: true,
        mode: "chat",
      });
      expect(result).toContain("平台命令说明");
      expect(result).toContain("macOS");
    });

    test("不包含平台命令段", () => {
      const result = buildSystemPrompt({
        basePrompt,
        includeInstructions: false,
        includePlatformCommands: false,
        mode: "chat",
      });
      expect(result).not.toContain("平台命令说明");
    });

    test("工具说明包含代码搜索策略", () => {
      const result = buildSystemPrompt({
        basePrompt,
        includeInstructions: false,
        includePlatformCommands: false,
        includeToolUsage: true,
        mode: "chat",
      });
      expect(result).toContain("代码搜索策略");
      expect(result).toContain("glob");
      expect(result).toContain("grep");
    });

    test("工具说明包含工具 schema 注入 (I6)", () => {
      const result = buildSystemPrompt({
        basePrompt,
        includeInstructions: false,
        includePlatformCommands: false,
        includeToolUsage: true,
        mode: "chat",
      });
      expect(result).toContain("tool-schema");
      expect(result).toContain("filesystem-read");
      expect(result).toContain("filesystem-write");
      expect(result).toContain("filesystem-edit");
      expect(result).toContain("terminal-execute");
    });

    test("Token 预算约束注入 (I5)", () => {
      const result = buildSystemPrompt({
        basePrompt,
        environment: { cwd: "/test" },
        includeInstructions: false,
        maxContextTokens: 128_000,
        maxTokens: 4096,
        mode: "chat",
      });
      expect(result).toContain("Token 预算");
      expect(result).toContain("4096");
      expect(result).toContain("128000");
    });

    test("动态 system-reminder 注入 (C2)", () => {
      const result = buildSystemPrompt({
        basePrompt,
        dynamicReminder: {
          activeSkills: ["code-review"],
          discoveredSkills: ["planner-candidate"],
          externalTools: ["apifox_export_openapi"],
          fileChanges: 5,
          loadedSkills: ["code-review", "test-gen"],
          turnNumber: 3,
        },
        environment: { cwd: "/test" },
        includeInstructions: false,
        mode: "chat",
      });
      expect(result).toContain("<system-reminder>");
      expect(result).toContain("已发现的 Skills");
      expect(result).toContain("已激活的 Skills");
      expect(result).toContain("code-review");
      expect(result).toContain("当前会话已启用的外部工具");
      expect(result).toContain("5 个文件");
      expect(result).toContain("对话轮次: 3");
    });

    test("previewSystemPrompt 返回完整预览", () => {
      const result = previewSystemPrompt({
        basePrompt,
        environment: { cwd: "/preview" },
        includeInstructions: false,
        mode: "team",
      });

      expect(result).toContain("# 测试助手");
      expect(result).toContain("Team 模式规则");
      expect(result).toContain("Working directory: /preview");
    });
  });

  describe("buildSystemPromptAsync", () => {
    test("异步构建支持本地指令文件注入", async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "prompt-async-local-"));
      fs.writeFileSync(path.join(tempDir, "AGENTS.md"), "## Local Instructions\nDo the right thing.\n");

      const result = await buildSystemPromptAsync({
        basePrompt,
        environment: { cwd: tempDir, platform: "linux" },
        includeInstructions: true,
        includePlatformCommands: true,
        includeToolUsage: false,
        instructionRoot: tempDir,
        mode: "chat",
      });

      expect(result).toContain("平台命令说明");
      expect(result).toContain("Instructions from:");
      expect(result).toContain("Local Instructions");
      expect(result).toContain(`Working directory: ${tempDir}`);

      fs.rmSync(tempDir, { force: true, recursive: true });
    });

    test("异步构建覆盖 token/reminder/append 串联", async () => {
      const result = await buildSystemPromptAsync({
        basePrompt,
        customAppend: "## Extra\nappendix",
        dynamicReminder: {
          externalTools: ["context7_query_docs"],
          extra: "keep it tight",
          fileChanges: 2,
          loadedSkills: ["planner"],
          turnNumber: 7,
        },
        environment: { cwd: "/async-test", platform: "darwin" },
        includeInstructions: false,
        includeToolUsage: true,
        maxContextTokens: 64_000,
        maxTokens: 2048,
        mode: "plan",
      });

      expect(result).toContain("Plan 模式规则");
      expect(result).toContain("工具使用说明");
      expect(result).toContain("Token 预算");
      expect(result).toContain("2048");
      expect(result).toContain("64000");
      expect(result).toContain("<system-reminder>");
      expect(result).toContain("planner");
      expect(result).toContain("context7_query_docs");
      expect(result).toContain("keep it tight");
      expect(result).toContain("appendix");
    });
  });

  describe("getModeInstruction", () => {
    test("chat 模式返回对话规则", () => {
      const instruction = getModeInstruction("chat");
      expect(instruction).toContain("对话模式规则");
    });

    test("plan 模式返回计划规则", () => {
      const instruction = getModeInstruction("plan");
      expect(instruction).toContain("Plan 模式规则");
    });

    test("team 模式返回团队规则", () => {
      const instruction = getModeInstruction("team");
      expect(instruction).toContain("Team 模式规则");
    });

    test("yolo 模式返回 YOLO 规则", () => {
      const instruction = getModeInstruction("yolo");
      expect(instruction).toContain("YOLO 模式规则");
    });

    test("simple 模式返回简单规则", () => {
      const instruction = getModeInstruction("simple");
      expect(instruction).toContain("Simple 模式规则");
    });

    test("security 模式返回安全审计规则", () => {
      const instruction = getModeInstruction("security");
      expect(instruction).toContain("Security 审计模式规则");
    });
  });

  describe("isReadOnlyMode", () => {
    test("plan 模式是只读的", () => {
      expect(isReadOnlyMode("plan")).toBe(true);
    });

    test("security 模式是只读的", () => {
      expect(isReadOnlyMode("security")).toBe(true);
    });

    test("chat 模式不是只读的", () => {
      expect(isReadOnlyMode("chat")).toBe(false);
    });

    test("team 模式不是只读的", () => {
      expect(isReadOnlyMode("team")).toBe(false);
    });

    test("yolo 模式不是只读的", () => {
      expect(isReadOnlyMode("yolo")).toBe(false);
    });

    test("simple 模式不是只读的", () => {
      expect(isReadOnlyMode("simple")).toBe(false);
    });
  });

  describe("isAutoApproveMode", () => {
    test("yolo 模式自动批准", () => {
      expect(isAutoApproveMode("yolo")).toBe(true);
    });

    test("chat 模式不自动批准", () => {
      expect(isAutoApproveMode("chat")).toBe(false);
    });

    test("YOLO 叠加时自动批准", () => {
      expect(isAutoApproveMode("chat", true)).toBe(true);
    });

    test("无 YOLO 叠加时不自动批准", () => {
      expect(isAutoApproveMode("chat", false)).toBe(false);
    });
  });

  describe("selectBasePromptByModel (C3)", () => {
    test("Claude 模型选择 Claude 基础提示词", () => {
      const prompt = selectBasePromptByModel("anthropic/claude-sonnet-4", "fallback");
      expect(prompt).toContain("Claude");
      expect(prompt).not.toBe("fallback");
    });

    test("GPT 模型选择 GPT 基础提示词", () => {
      const prompt = selectBasePromptByModel("openai/gpt-4o", "fallback");
      expect(prompt).toContain("GPT");
      expect(prompt).not.toBe("fallback");
    });

    test("Gemini 模型选择 Gemini 基础提示词", () => {
      const prompt = selectBasePromptByModel("google/gemini-2.0", "fallback");
      expect(prompt).toContain("Gemini");
      expect(prompt).not.toBe("fallback");
    });

    test("未知模型使用 fallback", () => {
      const prompt = selectBasePromptByModel("unknown/model", "fallback");
      expect(prompt).toBe("fallback");
    });
  });

  describe("buildDynamicReminder (C2)", () => {
    test("空选项返回空字符串", () => {
      expect(buildDynamicReminder({})).toBe("");
    });

    test("包含 skills 信息", () => {
      const result = buildDynamicReminder({
        activeSkills: ["a"],
        discoveredSkills: ["candidate"],
        loadedSkills: ["b"],
      });
      expect(result).toContain("<system-reminder>");
      expect(result).toContain("已发现的 Skills: candidate");
      expect(result).toContain("已激活的 Skills: a");
      expect(result).toContain("已加载的 Skills: b");
    });

    test("包含外部工具信息", () => {
      const result = buildDynamicReminder({ externalTools: ["apifox_export_openapi"] });
      expect(result).toContain("当前会话已启用的外部工具: apifox_export_openapi");
    });

    test("包含文件变化数", () => {
      const result = buildDynamicReminder({ fileChanges: 10 });
      expect(result).toContain("10 个文件");
    });

    test("包含轮次信息", () => {
      const result = buildDynamicReminder({ turnNumber: 5 });
      expect(result).toContain("对话轮次: 5");
    });

    test("包含额外信息", () => {
      const result = buildDynamicReminder({ extra: "自定义提醒" });
      expect(result).toContain("自定义提醒");
    });
  });
});
