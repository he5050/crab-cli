/**
 * 工具集成测试。
 *
 * 测试用例:
 *   - 工具注册
 *   - 工具调用
 *   - 工具结果处理
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { AppConfigSchema } from "@/schema/config";
import { globalBus } from "@/bus";
import { AppEvent } from "@/bus";
import { ConversationHandler } from "@/conversation";
import { registerTool, unregisterTool } from "@/tool/registry/toolRegistry";
import { defineTool } from "@/tool/types";
import { resetTestTools } from "../../helpers/testTools";
import { loadRealTestConfig } from "../../helpers/realConfig";
import { cleanupTestDir, createGlobalTmpTestDir } from "../../helpers/testPaths";
import { installDbIsolation } from "../../helpers/dbIsolation";
import { clearUsageMemoryForTest, readUsageMemory } from "@/session/usageMemory";

let REAL_CONFIG: AppConfigSchema;
let tempDir: string;
installDbIsolation("tool-integration-db-");

describe("工具集成 — 真实 Registry + Permission", () => {
  beforeAll(async () => {
    REAL_CONFIG = await loadRealTestConfig();
    tempDir = createGlobalTmpTestDir("crab-integration-");
    clearUsageMemoryForTest(process.cwd());
    await fs.writeFile(path.join(tempDir, "test.txt"), "integration test content");
  });

  test("通过真实 toolRegistry 执行 filesystem-read", async () => {
    let callRound = 0;
    const streamFn = async function* streamFn() {
      callRound++;
      if (callRound === 1) {
        yield {
          args: { path: path.join(tempDir, "test.txt") },
          toolCallId: "c1",
          toolName: "filesystem-read",
          type: "tool-call" as const,
        };
        yield { fullText: "", type: "done" as const };
      } else {
        yield { text: "文件内容是 integration test content", type: "text-delta" as const };
        yield { fullText: "文件内容是 integration test content", type: "done" as const };
      }
    };

    const handler = new ConversationHandler(REAL_CONFIG, { streamFn });
    handler.getPermissionManager().approve("fs.read", "**");

    const result = await handler.sendMessage("read test.txt");

    expect(result.ok).toBe(true);
    expect(result.text).toContain("integration test content");
  });

  test("plan 模式不会向 LLM 暴露写入和执行类工具", async () => {
    let capturedTools: Record<string, unknown> | undefined;
    const streamFn = async function* streamFn(
      _config: unknown,
      _messages: unknown,
      options?: { tools?: Record<string, unknown> },
    ) {
      capturedTools = options?.tools;
      yield { text: "planned", type: "text-delta" as const };
      yield { fullText: "planned", type: "done" as const };
    };

    const handler = new ConversationHandler(REAL_CONFIG, {
      mode: "plan" as any,
      streamFn,
    });

    const result = await handler.sendMessage("plan only");

    expect(result.ok).toBe(true);
    expect(capturedTools).toBeDefined();
    expect(capturedTools!["filesystem-read"]).toBeDefined();
    expect(capturedTools!["grep"]).toBeDefined();
    expect(capturedTools!["filesystem-write"]).toBeUndefined();
    expect(capturedTools!["filesystem-edit"]).toBeUndefined();
    expect(capturedTools!["filesystem-multi-edit"]).toBeUndefined();
    expect(capturedTools!["apply-patch"]).toBeUndefined();
    expect(capturedTools!["terminal-execute"]).toBeUndefined();
  });

  test("plan 模式执行层拒绝写入类工具调用", async () => {
    const target = path.join(tempDir, "plan-mode-write-blocked.txt");
    let callRound = 0;
    const streamFn = async function* streamFn() {
      callRound++;
      if (callRound === 1) {
        yield {
          args: { content: "should not exist", path: target },
          toolCallId: "plan-write-1",
          toolName: "filesystem-write",
          type: "tool-call" as const,
        };
        yield { fullText: "", type: "done" as const };
      } else {
        yield { text: "blocked", type: "text-delta" as const };
        yield { fullText: "blocked", type: "done" as const };
      }
    };

    const handler = new ConversationHandler(REAL_CONFIG, {
      mode: "plan" as any,
      streamFn,
    });

    const result = await handler.sendMessage("try to write in plan mode");

    expect(result.ok).toBe(true);
    expect(callRound).toBe(2);
    await expect(fs.stat(target)).rejects.toThrow();
    const messages = handler.getMessages();
    expect(JSON.stringify(messages)).toContain("不在当前 Agent 的可用工具列表中");
  });

  test("tool-search 发现唯一外部工具后，下一轮 LLM tools 自动暴露该工具", async () => {
    const externalTool = defineTool({
      description: "Apifox export OpenAPI integration",
      execute: async () => ({ ok: true }),
      name: "apifox_export_openapi_integration",
      parameters: z.object({}),
      permission: "mcp.apifox.export_openapi",
    });
    registerTool(externalTool);

    const capturedTools: Record<string, unknown>[] = [];
    let callRound = 0;
    const streamFn = async function* streamFn(
      _config: unknown,
      _messages: unknown,
      options?: { tools?: Record<string, unknown> },
    ) {
      capturedTools.push(options?.tools ?? {});
      callRound++;
      if (callRound === 1) {
        yield {
          args: { query: "apifox_export_openapi_integration" },
          toolCallId: "discover-apifox",
          toolName: "tool-search",
          type: "tool-call" as const,
        };
        yield { fullText: "", type: "done" as const };
        return;
      }

      expect(options?.tools?.["apifox_export_openapi_integration"]).toBeDefined();
      yield { text: "discovered", type: "text-delta" as const };
      yield { fullText: "discovered", type: "done" as const };
    };

    const handler = new ConversationHandler(REAL_CONFIG, { maxToolRounds: 2, streamFn });
    handler.getPermissionManager().approve("tool_search", "**");

    try {
      const result = await handler.sendMessage("discover apifox");
      const messages = handler.getMessages();

      expect(result.ok).toBe(true);
      expect(callRound).toBe(2);
      expect(capturedTools[0]?.["apifox_export_openapi_integration"]).toBeUndefined();
      expect(capturedTools[1]?.["apifox_export_openapi_integration"]).toBeDefined();
      expect(JSON.stringify(messages)).toContain("sessionEnabledExternalTools");
      expect(JSON.stringify(messages)).toContain("apifox_export_openapi_integration");
    } finally {
      unregisterTool("apifox_export_openapi_integration");
      handler.destroy();
    }
  });

  test("skills search 发现 Skill 后，下一轮 LLM system prompt 注入已发现 Skill 缓存", async () => {
    const capturedSystems: string[] = [];
    let callRound = 0;
    const streamFn = async function* streamFn(_config: unknown, _messages: unknown, options?: { system?: string }) {
      capturedSystems.push(options?.system ?? "");
      callRound++;
      if (callRound === 1) {
        yield {
          args: { action: "search", query: "fix-bug" },
          toolCallId: "discover-fix-bug-skill",
          toolName: "skills",
          type: "tool-call" as const,
        };
        yield { fullText: "", type: "done" as const };
        return;
      }

      expect(options?.system).toContain("已发现的 Skills: fix-bug");
      yield { text: "skill cached", type: "text-delta" as const };
      yield { fullText: "skill cached", type: "done" as const };
    };

    const handler = new ConversationHandler(REAL_CONFIG, {
      maxToolRounds: 2,
      streamFn,
      systemPrompt: "base prompt",
    });
    handler.getPermissionManager().approve("fs.read", "**");

    try {
      const result = await handler.sendMessage("find a skill for bug fixing");
      const messages = handler.getMessages();

      expect(result.ok).toBe(true);
      expect(callRound).toBe(2);
      expect(capturedSystems[0]).not.toContain("已发现的 Skills: fix-bug");
      expect(capturedSystems[1]).toContain("已发现的 Skills: fix-bug");
      expect(JSON.stringify(messages)).toContain("sessionDiscoveredSkills");
      expect(JSON.stringify(messages)).toContain("fix-bug");
    } finally {
      handler.destroy();
    }
  });

  test("skills recommend 基于上下文推荐后，下一轮 LLM system prompt 注入已发现 Skill 缓存", async () => {
    const capturedSystems: string[] = [];
    let callRound = 0;
    const streamFn = async function* streamFn(_config: unknown, _messages: unknown, options?: { system?: string }) {
      capturedSystems.push(options?.system ?? "");
      callRound++;
      if (callRound === 1) {
        yield {
          args: { action: "recommend", context: "需要修复 bug 并验证本次工作" },
          toolCallId: "recommend-fix-bug-skill",
          toolName: "skills",
          type: "tool-call" as const,
        };
        yield { fullText: "", type: "done" as const };
        return;
      }

      expect(options?.system).toContain("已发现的 Skills:");
      yield { text: "skill recommended", type: "text-delta" as const };
      yield { fullText: "skill recommended", type: "done" as const };
    };

    const handler = new ConversationHandler(REAL_CONFIG, {
      maxToolRounds: 2,
      streamFn,
      systemPrompt: "base prompt",
    });
    handler.getPermissionManager().approve("fs.read", "**");

    try {
      const result = await handler.sendMessage("recommend a skill for bug fixing");
      const messages = handler.getMessages();

      expect(result.ok).toBe(true);
      expect(callRound).toBe(2);
      expect(capturedSystems[1]).toContain("已发现的 Skills:");
      expect(JSON.stringify(messages)).toContain("sessionDiscoveredSkills");
      expect(JSON.stringify(messages)).toContain("recommendations");
    } finally {
      handler.destroy();
    }
  });

  test("显式 /skill 引用会直接加入会话已激活 Skill 缓存，无需先 search", async () => {
    const capturedSystems: string[] = [];
    const streamFn = async function* streamFn(_config: unknown, _messages: unknown, options?: { system?: string }) {
      capturedSystems.push(options?.system ?? "");
      expect(options?.system).toContain("已激活的 Skills: fix-bug");
      yield { text: "explicit skill loaded", type: "text-delta" as const };
      yield { fullText: "explicit skill loaded", type: "done" as const };
    };

    const handler = new ConversationHandler(REAL_CONFIG, {
      maxToolRounds: 1,
      streamFn,
      systemPrompt: "base prompt",
    });

    try {
      const result = await handler.sendMessage("/skill:fix-bug 请按这个技能处理");
      expect(result.ok).toBe(true);
      expect(capturedSystems[0]).toContain("已激活的 Skills: fix-bug");
      expect(JSON.stringify(handler.getMessages())).not.toContain('"action":"search"');
    } finally {
      handler.destroy();
    }
  });

  test("skills execute 成功后记录长期 usage memory", async () => {
    clearUsageMemoryForTest(process.cwd());
    let callRound = 0;
    const streamFn = async function* streamFn(_config: unknown, _messages: unknown, options?: { system?: string }) {
      callRound++;
      if (callRound === 1) {
        yield {
          args: { action: "execute", input: "修复并验证 skill usage memory", skillName: "fix-bug" },
          toolCallId: "execute-fix-bug-memory",
          toolName: "skills",
          type: "tool-call" as const,
        };
        yield { fullText: "", type: "done" as const };
        return;
      }
      expect(options?.system).toContain("已加载的 Skills: fix-bug");
      yield { text: "skill memory recorded", type: "text-delta" as const };
      yield { fullText: "skill memory recorded", type: "done" as const };
    };

    const handler = new ConversationHandler(REAL_CONFIG, {
      maxToolRounds: 2,
      streamFn,
      systemPrompt: "base prompt",
    });
    handler.getPermissionManager().approve("fs.read", "**");

    try {
      const result = await handler.sendMessage("修复并验证 skill usage memory");
      expect(result.ok).toBe(true);
      const records = readUsageMemory(process.cwd());
      expect(records.some((item) => item.kind === "skill" && item.name === "fix-bug" && item.successCount > 0)).toBe(
        true,
      );
      expect(JSON.stringify(records)).not.toContain("Prompt 将传递给 AI 执行");
    } finally {
      handler.destroy();
    }
  });

  test("显式 /mcp 引用会直接启用外部工具并在下一轮 tools 中可见", async () => {
    const externalTool = defineTool({
      description: "Apifox export explicit integration",
      execute: async () => ({ ok: true }),
      name: "apifox_export_explicit_integration",
      parameters: z.object({}),
      permission: "mcp.apifox.export_openapi",
    });
    registerTool(externalTool);

    const capturedTools: Record<string, unknown>[] = [];
    const capturedSystems: string[] = [];
    const streamFn = async function* streamFn(
      _config: unknown,
      _messages: unknown,
      options?: { tools?: Record<string, unknown>; system?: string },
    ) {
      capturedTools.push(options?.tools ?? {});
      capturedSystems.push(options?.system ?? "");
      expect(options?.tools?.["apifox_export_explicit_integration"]).toBeDefined();
      expect(options?.system).toContain("当前会话已启用的外部工具: apifox_export_explicit_integration");
      yield { text: "explicit mcp enabled", type: "text-delta" as const };
      yield { fullText: "explicit mcp enabled", type: "done" as const };
    };

    const handler = new ConversationHandler(REAL_CONFIG, {
      maxToolRounds: 1,
      streamFn,
      systemPrompt: "base prompt",
    });

    try {
      const result = await handler.sendMessage("/mcp:apifox_export_explicit_integration 请使用这个外部工具");
      expect(result.ok).toBe(true);
      expect(capturedTools[0]?.["apifox_export_explicit_integration"]).toBeDefined();
      expect(capturedSystems[0]).toContain("当前会话已启用的外部工具");
    } finally {
      unregisterTool("apifox_export_explicit_integration");
      handler.destroy();
    }
  });

  test("外部 MCP 工具体执行成功后记录长期 usage memory", async () => {
    clearUsageMemoryForTest(process.cwd());
    const externalTool = defineTool({
      description: "Context7 query docs usage memory",
      execute: async () => ({ docs: "react hooks docs should not be persisted", ok: true }),
      name: "context7_query_docs_usage_memory",
      parameters: z.object({ library: z.string() }),
      permission: "mcp.context7.query_docs",
    });
    registerTool(externalTool);

    let callRound = 0;
    const streamFn = async function* streamFn() {
      callRound++;
      if (callRound === 1) {
        yield {
          args: { library: "react" },
          toolCallId: "context7-memory",
          toolName: "context7_query_docs_usage_memory",
          type: "tool-call" as const,
        };
        yield { fullText: "", type: "done" as const };
        return;
      }
      yield { text: "external memory recorded", type: "text-delta" as const };
      yield { fullText: "external memory recorded", type: "done" as const };
    };

    const handler = new ConversationHandler(REAL_CONFIG, { maxToolRounds: 2, streamFn });
    handler.getPermissionManager().approve("mcp.context7.query_docs", "**");

    try {
      const result = await handler.sendMessage("/mcp:context7_query_docs_usage_memory 读取 react 文档");
      expect(result.ok).toBe(true);
      const records = readUsageMemory(process.cwd());
      expect(
        records.some(
          (item) =>
            item.kind === "external_tool" && item.name === "context7_query_docs_usage_memory" && item.successCount > 0,
        ),
      ).toBe(true);
      expect(JSON.stringify(records)).not.toContain("react hooks docs should not be persisted");
    } finally {
      unregisterTool("context7_query_docs_usage_memory");
      handler.destroy();
    }
  });

  test("外部 MCP 工具体失败后记录 usage memory 负反馈", async () => {
    clearUsageMemoryForTest(process.cwd());
    const externalTool = defineTool({
      description: "Apifox export usage failure",
      execute: async () => {
        throw new Error("openapi export secret failure body should not be persisted");
      },
      name: "apifox_export_usage_failure",
      parameters: z.object({ project: z.string() }),
      permission: "mcp.apifox.export_openapi",
    });
    registerTool(externalTool);

    const streamFn = async function* streamFn() {
      yield {
        args: { project: "demo" },
        toolCallId: "apifox-memory-failure",
        toolName: "apifox_export_usage_failure",
        type: "tool-call" as const,
      };
      yield { fullText: "", type: "done" as const };
    };

    const handler = new ConversationHandler(REAL_CONFIG, { maxToolRounds: 1, streamFn });
    handler.getPermissionManager().approve("mcp.apifox.export_openapi", "**");

    try {
      await handler.sendMessage("/mcp:apifox_export_usage_failure 导出 openapi");
      const records = readUsageMemory(process.cwd());
      const record = records.find(
        (item) => item.kind === "external_tool" && item.name === "apifox_export_usage_failure",
      );
      expect(record?.failureCount).toBeGreaterThan(0);
      expect(JSON.stringify(records)).not.toContain("openapi export secret failure body should not be persisted");
    } finally {
      unregisterTool("apifox_export_usage_failure");
      handler.destroy();
    }
  });

  test("tool-search 发现多个外部工具后，下一轮 LLM tools 自动暴露这些工具", async () => {
    const apifoxTool = defineTool({
      description: "Apifox export OpenAPI multi integration",
      execute: async () => ({ ok: true }),
      name: "apifox_export_openapi_multi_integration",
      parameters: z.object({}),
      permission: "mcp.apifox.export_openapi",
    });
    const context7Tool = defineTool({
      description: "Context7 query docs multi integration",
      execute: async () => ({ ok: true }),
      name: "context7_query_docs_multi_integration",
      parameters: z.object({}),
      permission: "mcp.context7.query_docs",
    });
    registerTool(apifoxTool);
    registerTool(context7Tool);

    const capturedTools: Record<string, unknown>[] = [];
    let callRound = 0;
    const streamFn = async function* streamFn(
      _config: unknown,
      _messages: unknown,
      options?: { tools?: Record<string, unknown> },
    ) {
      capturedTools.push(options?.tools ?? {});
      callRound++;
      if (callRound === 1) {
        yield {
          args: { query: "multi integration" },
          toolCallId: "discover-multiple-external",
          toolName: "tool-search",
          type: "tool-call" as const,
        };
        yield { fullText: "", type: "done" as const };
        return;
      }

      expect(options?.tools?.["apifox_export_openapi_multi_integration"]).toBeDefined();
      expect(options?.tools?.["context7_query_docs_multi_integration"]).toBeDefined();
      yield { text: "discovered multiple", type: "text-delta" as const };
      yield { fullText: "discovered multiple", type: "done" as const };
    };

    const handler = new ConversationHandler(REAL_CONFIG, { maxToolRounds: 2, streamFn });
    handler.getPermissionManager().approve("tool_search", "**");

    try {
      const result = await handler.sendMessage("discover multiple external tools");
      const messages = handler.getMessages();

      expect(result.ok).toBe(true);
      expect(callRound).toBe(2);
      expect(capturedTools[0]?.["apifox_export_openapi_multi_integration"]).toBeUndefined();
      expect(capturedTools[0]?.["context7_query_docs_multi_integration"]).toBeUndefined();
      expect(capturedTools[1]?.["apifox_export_openapi_multi_integration"]).toBeDefined();
      expect(capturedTools[1]?.["context7_query_docs_multi_integration"]).toBeDefined();
      expect(JSON.stringify(messages)).toContain("sessionEnabledExternalTools");
      expect(JSON.stringify(messages)).toContain("apifox_export_openapi_multi_integration");
      expect(JSON.stringify(messages)).toContain("context7_query_docs_multi_integration");
    } finally {
      unregisterTool("apifox_export_openapi_multi_integration");
      unregisterTool("context7_query_docs_multi_integration");
      handler.destroy();
    }
  });

  test("自然语言显式外部工具意图可先启用并在下一轮直接执行", async () => {
    let externalExecuted = false;
    const externalTool = defineTool({
      description: "Context7 query docs explicit integration",
      execute: async () => {
        externalExecuted = true;
        return { content: "react docs", ok: true };
      },
      name: "context7_query_docs_explicit_integration",
      parameters: z.object({ topic: z.string().optional() }),
      permission: "mcp.context7.query_docs",
    });
    registerTool(externalTool);

    const capturedTools: Record<string, unknown>[] = [];
    let callRound = 0;
    const streamFn = async function* streamFn(
      _config: unknown,
      _messages: unknown,
      options?: { tools?: Record<string, unknown> },
    ) {
      capturedTools.push(options?.tools ?? {});
      callRound++;
      if (callRound === 1) {
        yield {
          args: { topic: "react" },
          toolCallId: "enable-context7-explicit",
          toolName: "context7_query_docs_explicit_integration",
          type: "tool-call" as const,
        };
        yield { fullText: "", type: "done" as const };
        return;
      }
      if (callRound === 2) {
        expect(options?.tools?.["context7_query_docs_explicit_integration"]).toBeDefined();
        yield {
          args: { topic: "react" },
          toolCallId: "execute-context7-explicit",
          toolName: "context7_query_docs_explicit_integration",
          type: "tool-call" as const,
        };
        yield { fullText: "", type: "done" as const };
        return;
      }

      yield { text: "external tool executed", type: "text-delta" as const };
      yield { fullText: "external tool executed", type: "done" as const };
    };

    const handler = new ConversationHandler(REAL_CONFIG, { maxToolRounds: 3, streamFn });
    handler.getPermissionManager().approve("mcp.context7.query_docs", "**");

    try {
      const result = await handler.sendMessage("用 context7_query_docs_explicit_integration 查 React 文档");
      const messages = handler.getMessages();

      expect(result.ok).toBe(true);
      expect(callRound).toBe(3);
      expect(externalExecuted).toBe(true);
      expect(capturedTools[0]?.["context7_query_docs_explicit_integration"]).toBeUndefined();
      expect(capturedTools[1]?.["context7_query_docs_explicit_integration"]).toBeDefined();
      expect(JSON.stringify(messages)).toContain("下一轮 LLM 请求可直接调用");
      expect(JSON.stringify(messages)).toContain("react docs");
    } finally {
      unregisterTool("context7_query_docs_explicit_integration");
      handler.destroy();
    }
  });

  test("多候选外部工具由模型重新发现而不是进入用户选择流程", async () => {
    const githubTool = defineTool({
      description: "GitHub search code auto disambiguation",
      execute: async () => ({ ok: true }),
      name: "github_search_code_auto_disambiguation",
      parameters: z.object({}),
      permission: "mcp.github.search_code",
    });
    const wikiTool = defineTool({
      description: "ZRead search wiki auto disambiguation",
      execute: async () => ({ ok: true }),
      name: "zread_search_wiki_auto_disambiguation",
      parameters: z.object({}),
      permission: "mcp.zread.search_wiki",
    });
    registerTool(githubTool);
    registerTool(wikiTool);

    const capturedTools: Record<string, unknown>[] = [];
    let callRound = 0;
    const streamFn = async function* streamFn(
      _config: unknown,
      _messages: unknown,
      options?: { tools?: Record<string, unknown> },
    ) {
      capturedTools.push(options?.tools ?? {});
      callRound++;
      if (callRound === 1) {
        yield {
          args: {},
          toolCallId: "ambiguous-external-search",
          toolName: "auto_disambiguation",
          type: "tool-call" as const,
        };
        yield { fullText: "", type: "done" as const };
        return;
      }
      if (callRound === 2) {
        expect(options?.tools?.["github_search_code_auto_disambiguation"]).toBeUndefined();
        yield {
          args: { query: "github_search_code_auto_disambiguation" },
          toolCallId: "rediscover-github-search",
          toolName: "tool-search",
          type: "tool-call" as const,
        };
        yield { fullText: "", type: "done" as const };
        return;
      }

      expect(options?.tools?.["github_search_code_auto_disambiguation"]).toBeDefined();
      yield { text: "rediscovered", type: "text-delta" as const };
      yield { fullText: "rediscovered", type: "done" as const };
    };

    const handler = new ConversationHandler(REAL_CONFIG, { maxToolRounds: 3, streamFn });
    handler.getPermissionManager().approve("tool_search", "**");

    try {
      const result = await handler.sendMessage("搜索代码，工具名不明确时自动重新发现");
      const messages = JSON.stringify(handler.getMessages());

      expect(result.ok).toBe(true);
      expect(callRound).toBe(3);
      expect(capturedTools[0]?.["github_search_code_auto_disambiguation"]).toBeUndefined();
      expect(capturedTools[1]?.["github_search_code_auto_disambiguation"]).toBeUndefined();
      expect(capturedTools[2]?.["github_search_code_auto_disambiguation"]).toBeDefined();
      expect(messages).toContain("外部工具名称不明确");
      expect(messages).toContain("github_search_code_auto_disambiguation");
      expect(messages).toContain("sessionEnabledExternalTools");
    } finally {
      unregisterTool("github_search_code_auto_disambiguation");
      unregisterTool("zread_search_wiki_auto_disambiguation");
      handler.destroy();
    }
  });

  test("兼容 arguments 包裹的 JSON 字符串参数", async () => {
    const toolResultEvents: any[] = [];
    const unsub = globalBus.subscribe(AppEvent.ToolResult, (e) => {
      if (e.properties.callId === "c1") {
        toolResultEvents.push(e.properties);
      }
    });

    let callRound = 0;
    const streamFn = async function* streamFn() {
      callRound++;
      if (callRound === 1) {
        yield {
          args: { arguments: JSON.stringify({ path: path.join(tempDir, "test.txt") }) },
          toolCallId: "c1",
          toolName: "filesystem-read",
          type: "tool-call" as const,
        };
        yield { fullText: "", type: "done" as const };
      } else {
        yield { text: "文件内容是 integration test content", type: "text-delta" as const };
        yield { fullText: "文件内容是 integration test content", type: "done" as const };
      }
    };

    const handler = new ConversationHandler(REAL_CONFIG, { streamFn });
    handler.getPermissionManager().approve("fs.read", "**");

    try {
      const result = await handler.sendMessage("read wrapped args");
      await globalBus.flush();

      expect(result.ok).toBe(true);
      expect(result.text).toContain("integration test content");
      expect(toolResultEvents).toHaveLength(1);
      expect(toolResultEvents[0].success).toBe(true);
      expect(JSON.stringify(toolResultEvents[0].result)).toContain("integration test content");
    } finally {
      unsub();
    }
  });

  test("权限拒绝 → filesystem-read 不执行", async () => {
    let callRound = 0;
    const streamFn = async function* streamFn() {
      callRound++;
      if (callRound === 1) {
        yield {
          args: { path: "/etc/passwd" },
          toolCallId: "c1",
          toolName: "filesystem-read",
          type: "tool-call" as const,
        };
        yield { fullText: "", type: "done" as const };
      } else {
        yield { text: "权限被拒绝", type: "text-delta" as const };
        yield { fullText: "权限被拒绝", type: "done" as const };
      }
    };

    const handler = new ConversationHandler(REAL_CONFIG, { streamFn });
    // 不批准任何权限

    const result = await handler.sendMessage("read passwd");

    expect(result.ok).toBe(true);
    expect(callRound).toBe(2);
  });

  test("ToolCall + ToolResult 事件发布一致性", async () => {
    const toolCallEvents: any[] = [];
    const toolResultEvents: any[] = [];

    const unsub1 = globalBus.subscribe(AppEvent.ToolCall, (e) => {
      toolCallEvents.push(e.properties);
    });
    const unsub2 = globalBus.subscribe(AppEvent.ToolResult, (e) => {
      toolResultEvents.push(e.properties);
    });

    try {
      let callRound = 0;
      const streamFn = async function* streamFn() {
        callRound++;
        if (callRound === 1) {
          yield {
            args: { path: path.join(tempDir, "test.txt") },
            toolCallId: "ev1",
            toolName: "filesystem-read",
            type: "tool-call" as const,
          };
          yield { fullText: "", type: "done" as const };
        } else {
          yield { text: "done", type: "text-delta" as const };
          yield { fullText: "done", type: "done" as const };
        }
      };

      const handler = new ConversationHandler(REAL_CONFIG, { streamFn });
      handler.getPermissionManager().approve("fs.read", "**");

      await handler.sendMessage("read file");
      await globalBus.flush();

      expect(toolCallEvents.length).toBe(1);
      expect(toolCallEvents[0].tool).toBe("filesystem-read");

      expect(toolResultEvents.length).toBe(1);
      expect(toolResultEvents[0].tool).toBe("filesystem-read");
      expect(toolResultEvents[0].success).toBe(true);
    } finally {
      unsub1();
      unsub2();
    }
  });

  test("历史消息结构 — tool-call + tool-result 正确追加", async () => {
    let callRound = 0;
    const streamFn = async function* streamFn() {
      callRound++;
      if (callRound === 1) {
        yield {
          args: { path: path.join(tempDir, "test.txt") },
          toolCallId: "c1",
          toolName: "filesystem-read",
          type: "tool-call" as const,
        };
        yield { fullText: "", type: "done" as const };
      } else {
        yield { text: "ok", type: "text-delta" as const };
        yield { fullText: "ok", type: "done" as const };
      }
    };

    const handler = new ConversationHandler(REAL_CONFIG, { streamFn });
    handler.getPermissionManager().approve("fs.read", "**");

    await handler.sendMessage("read file");
    const msgs = handler.getMessages();

    // [0] user, [1] assistant (tool-call), [2] tool (tool-result), [3] assistant (text)
    expect(msgs.length).toBe(4);
    expect(msgs[0]!.role).toBe("user");
    expect(msgs[1]!.role).toBe("assistant");
    expect(msgs[2]!.role).toBe("tool");
    expect(msgs[3]!.role).toBe("assistant");

    // Assistant 消息含 tool-call part
    const assistantContent = (msgs[1] as any).content;
    expect(Array.isArray(assistantContent)).toBe(true);
    expect(assistantContent[0].type).toBe("tool-call");
    expect(assistantContent[0].toolCallId).toBe("c1");

    // Tool 消息含 tool-result part
    const toolContent = (msgs[2] as any).content;
    expect(Array.isArray(toolContent)).toBe(true);
    expect(toolContent[0].type).toBe("tool-result");
    expect(toolContent[0].toolCallId).toBe("c1");
  });
});

afterAll(() => {
  cleanupTestDir(tempDir);
  resetTestTools();
});
