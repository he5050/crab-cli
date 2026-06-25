/**
 * 工具注册表测试。
 *
 * 测试用例:
 *   - 工具注册
 *   - 工具查询
 *   - 工具更新
 *   - 工具删除
 */
import { beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { defineTool } from "@/tool/types";
import {
  clearToolsCache,
  getBuiltinGroupName,
  getBuiltinToolGroups,
  getRegisteredTools,
  getToolsForAiSdk,
  getToolsForAiSdkByNames,
  registerTool,
  registerTools,
  unregisterTool,
} from "@/tool/registry/toolRegistry";
import { getToolsForLlm } from "@/conversation";
import { ConversationHandler } from "@/conversation";
import { resolveExplicitExternalToolReference, resolveExternalToolName } from "@/tool/registry/externalToolResolver";
import { clearUsageMemoryForTest, recordUsageMemory } from "@/session/usageMemory";
import { toolSearchTool } from "@/tool/toolSearch";

describe("工具注册表 — 注册/查询", () => {
  beforeEach(() => {
    // 清理:不能直接清 registry(模块私有)，但可以 unregister 已知的
    clearToolsCache();
  });

  test("registerTool 添加 a 工具", () => {
    const tool = defineTool({
      description: "Test tool 1",
      execute: async () => null,
      name: "registry_test_1",
      parameters: z.object({ x: z.number() }),
      permission: "test",
    });

    registerTool(tool);
    const tools = getRegisteredTools();
    expect(tools["registry_test_1"]).toBeDefined();
    expect(tools["registry_test_1"]!.name).toBe("registry_test_1");

    unregisterTool("registry_test_1");
  });

  test("registerTools 批量添加工具", () => {
    const tools = [
      defineTool({
        description: "Batch A",
        execute: async () => null,
        name: "batch_test_a",
        parameters: z.object({}),
        permission: "test",
      }),
      defineTool({
        description: "Batch B",
        execute: async () => null,
        name: "batch_test_b",
        parameters: z.object({}),
        permission: "test",
      }),
    ];

    registerTools(tools);
    const registered = getRegisteredTools();
    expect(registered["batch_test_a"]).toBeDefined();
    expect(registered["batch_test_b"]).toBeDefined();

    unregisterTool("batch_test_a");
    unregisterTool("batch_test_b");
  });

  test("unregisterTool 移除工具", () => {
    const tool = defineTool({
      description: "To be removed",
      execute: async () => null,
      name: "removable_tool",
      parameters: z.object({}),
      permission: "test",
    });

    registerTool(tool);
    expect(getRegisteredTools()["removable_tool"]).toBeDefined();

    unregisterTool("removable_tool");
    expect(getRegisteredTools()["removable_tool"]).toBeUndefined();
  });

  test("getRegisteredTools 返回复制", () => {
    const tool = defineTool({
      description: "Copy test",
      execute: async () => null,
      name: "copy_test",
      parameters: z.object({}),
      permission: "test",
    });
    registerTool(tool);

    const copy1 = getRegisteredTools();
    const copy2 = getRegisteredTools();
    expect(copy1).not.toBe(copy2); // 不同引用
    expect(copy1["copy_test"]).toBeDefined();

    unregisterTool("copy_test");
  });

  test("registering tool with same name keeps the first registration", () => {
    const v1 = defineTool({
      description: "Version 1",
      execute: async () => "v1",
      name: "overwrite_test",
      parameters: z.object({}),
      permission: "test",
    });

    const v2 = defineTool({
      description: "Version 2",
      execute: async () => "v2",
      name: "overwrite_test",
      parameters: z.object({}),
      permission: "test",
    });

    registerTool(v1);
    registerTool(v2);

    const registered = getRegisteredTools();
    expect(registered["overwrite_test"]!.description).toBe("Version 1");

    unregisterTool("overwrite_test");
  });
});

describe("工具注册表 — AI SDK 格式", () => {
  beforeEach(() => {
    clearToolsCache();
  });

  test("getToolsForAiSdk 转换至 AI SDK 格式", () => {
    const aiTools = getToolsForAiSdk();

    expect(aiTools["tool-search"]).toBeDefined();
    expect(aiTools["tool-search"].description).toContain("搜索和发现可用的工具");
    expect(aiTools["tool-search"].inputSchema).toBeDefined();
    expect(aiTools["tool-search"].execute).toBeUndefined();
  });

  test("tools cache is invalidated on register", () => {
    const tool1 = defineTool({
      description: "Cache test",
      execute: async () => null,
      name: "cache_test_1",
      parameters: z.object({}),
      permission: "test",
    });

    registerTool(tool1);
    const cached1 = getToolsForAiSdk();
    expect(cached1["cache_test_1"]).toBeUndefined();

    // 注册新工具应使缓存失效
    const tool2 = defineTool({
      description: "Cache test 2",
      execute: async () => null,
      name: "cache_test_2",
      parameters: z.object({}),
      permission: "test",
    });

    registerTool(tool2);
    const cached2 = getToolsForAiSdk();
    expect(cached2["cache_test_2"]).toBeUndefined();
    const allowed = getToolsForAiSdkByNames(["cache_test_2"]);
    expect(allowed["cache_test_2"]).toBeDefined();

    unregisterTool("cache_test_1");
    unregisterTool("cache_test_2");
  });

  test("clearToolsCache 强制重新生成", () => {
    const tool = defineTool({
      description: "Clear cache test",
      execute: async () => null,
      name: "clear_cache_test",
      parameters: z.object({}),
      permission: "test",
    });

    registerTool(tool);
    const t1 = getToolsForAiSdk();
    clearToolsCache();
    const t2 = getToolsForAiSdk();

    // 两次应返回不同的缓存对象
    expect(t1).not.toBe(t2);
    expect(t2["clear_cache_test"]).toBeUndefined();
    const allowed = getToolsForAiSdkByNames(["clear_cache_test"]);
    expect(allowed["clear_cache_test"]).toBeDefined();

    unregisterTool("clear_cache_test");
  });

  test("default AI SDK tools only expose builtin tools", () => {
    const externalTool = defineTool({
      description: "External demo tool",
      execute: async () => null,
      name: "external_demo_tool",
      parameters: z.object({}),
      permission: "mcp.demo.external",
    });

    registerTool(externalTool);
    const aiTools = getToolsForAiSdk();

    expect(aiTools["external_demo_tool"]).toBeUndefined();

    unregisterTool("external_demo_tool");
  });

  test("default AI SDK todo tools expose only unified todo-ultra", () => {
    const aiTools = getToolsForAiSdk();

    expect(aiTools["todo-ultra"]).toBeDefined();
    expect(aiTools["todo-manage"]).toBeUndefined();

    const explicitTools = getToolsForAiSdkByNames(["todo-manage"]);
    expect(explicitTools["todo-manage"]).toBeUndefined();
  });

  test("搜索整合保留都公共搜索工具已注册", () => {
    const registered = getRegisteredTools();
    const aiTools = getToolsForAiSdk();
    const groups = getBuiltinToolGroups();

    expect(registered["codebase-search"]).toBeDefined();
    expect(registered["ace-enhanced-search"]).toBeDefined();
    expect(aiTools["codebase-search"]).toBeDefined();
    expect(aiTools["ace-enhanced-search"]).toBeDefined();
    expect(getBuiltinGroupName("codebase-search")).toBe("codebase-search");
    expect(getBuiltinGroupName("ace-enhanced-search")).toBe("ace-enhanced-search");
    expect(groups.some((group) => group.name === "codebase-search" && group.tools.includes("codebase-search"))).toBe(
      true,
    );
    expect(
      groups.some((group) => group.name === "ace-enhanced-search" && group.tools.includes("ace-enhanced-search")),
    ).toBe(true);
  });

  test("filesystem tools are represented by a single builtin group", () => {
    const filesystemGroups = getBuiltinToolGroups().filter((group) => group.name === "filesystem");

    expect(filesystemGroups).toHaveLength(1);
    expect(filesystemGroups[0]!.tools).toContain("filesystem-read");
    expect(filesystemGroups[0]!.tools).toContain("filesystem-multi-edit");
    expect(getBuiltinGroupName("filesystem-multi-edit")).toBe("filesystem");
  });

  test("显式允许列表可暴露外部工具", () => {
    const externalTool = defineTool({
      description: "External demo tool",
      execute: async () => null,
      name: "external_demo_tool",
      parameters: z.object({}),
      permission: "mcp.demo.external",
    });

    registerTool(externalTool);
    const aiTools = getToolsForAiSdkByNames(["external_demo_tool"]);

    expect(aiTools["external_demo_tool"]).toBeDefined();

    unregisterTool("external_demo_tool");
  });

  test("会话 allowedTools 使外部工具可见在下一 LLM 工具构建", () => {
    const externalTool = defineTool({
      description: "Session external tool",
      execute: async () => null,
      name: "session_external_tool",
      parameters: z.object({}),
      permission: "mcp.demo.session",
    });

    registerTool(externalTool);

    const defaultTools = getToolsForLlm({
      allowedTools: undefined,
      messages: [],
    } as any);
    expect(defaultTools?.["session_external_tool"]).toBeUndefined();

    const sessionTools = getToolsForLlm({
      allowedTools: ["session_external_tool"],
      messages: [],
    } as any);
    expect(sessionTools?.["session_external_tool"]).toBeDefined();

    unregisterTool("session_external_tool");
  });

  test("explicit external tool name resolves to a unique callable name for session allow-list", () => {
    const externalTool = defineTool({
      description: "Apifox export OpenAPI",
      execute: async () => null,
      name: "apifox_export_openapi",
      parameters: z.object({}),
      permission: "mcp.apifox.export_openapi",
    });

    registerTool(externalTool);

    const resolution = resolveExternalToolName("apifox:export_openapi", getRegisteredTools());
    expect(resolution).toEqual({ status: "unique", toolName: "apifox_export_openapi" });
    expect(resolveExternalToolName("apifox-export-openapi", getRegisteredTools())).toEqual({
      status: "unique",
      toolName: "apifox_export_openapi",
    });

    const sessionTools = getToolsForLlm({
      allowedTools: ["apifox-export-openapi"],
      messages: [],
    } as any);
    expect(sessionTools?.["apifox_export_openapi"]).toBeDefined();

    unregisterTool("apifox_export_openapi");
  });

  test("external tool short name returns candidates when multiple tools match", () => {
    const first = defineTool({
      description: "GitHub search code",
      execute: async () => null,
      name: "github_search_code",
      parameters: z.object({}),
      permission: "mcp.github.search_code",
    });
    const second = defineTool({
      description: "ZRead search wiki",
      execute: async () => null,
      name: "zread_search_wiki",
      parameters: z.object({}),
      permission: "mcp.zread.search_wiki",
    });

    registerTools([first, second]);

    const resolution = resolveExternalToolName("search", getRegisteredTools());
    expect(resolution.status).toBe("ambiguous");
    expect(resolution.status === "ambiguous" ? resolution.candidates : []).toEqual([
      "github_search_code",
      "zread_search_wiki",
    ]);

    unregisterTool("github_search_code");
    unregisterTool("zread_search_wiki");
  });

  test("external tool resolver reports not_found for unknown user-specified tools", () => {
    const resolution = resolveExternalToolName("missing_external_tool", getRegisteredTools());
    expect(resolution).toEqual({ query: "missing_external_tool", status: "not_found" });
  });

  test("external tool resolver supports explicit /mcp and tool:// references", () => {
    const externalTool = defineTool({
      description: "Apifox export explicit resolver",
      execute: async () => null,
      name: "apifox_export_explicit_resolver",
      parameters: z.object({}),
      permission: "mcp.apifox.export",
    });
    registerTool(externalTool);

    try {
      expect(
        resolveExplicitExternalToolReference("/mcp:apifox_export_explicit_resolver", getRegisteredTools()),
      ).toEqual([{ status: "unique", toolName: "apifox_export_explicit_resolver" }]);
      expect(
        resolveExplicitExternalToolReference("tool://apifox:export_explicit_resolver", getRegisteredTools()),
      ).toEqual([{ status: "unique", toolName: "apifox_export_explicit_resolver" }]);
    } finally {
      unregisterTool("apifox_export_explicit_resolver");
    }
  });

  test("tool-search 返回外部工具时带 usage memory boost", async () => {
    clearUsageMemoryForTest(process.cwd());
    const externalTool = defineTool({
      description: "Context7 query docs memory rank",
      execute: async () => null,
      name: "context7_query_docs_memory_rank",
      parameters: z.object({}),
      permission: "mcp.context7.query_docs",
    });
    registerTool(externalTool);
    recordUsageMemory({
      kind: "external_tool",
      name: "context7_query_docs_memory_rank",
      permissionsPassed: true,
      projectDir: process.cwd(),
      scenario: "读取 react hooks 文档",
      source: "direct_call",
      success: true,
    });

    try {
      const result = (await toolSearchTool.execute({
        query: "context7 query docs react hooks",
        verbose: false,
      } as any)) as any;
      const found = result.tools.find((tool: any) => tool.name === "context7_query_docs_memory_rank");
      expect(found).toBeDefined();
      expect(found.usageBoost).toBeGreaterThan(0);
      expect(found.usageReasons.join(" ")).toContain("usage memory");
    } finally {
      unregisterTool("context7_query_docs_memory_rank");
    }
  });

  test("conversation session external allow-list exposes a unique external tool without hiding builtins", () => {
    const externalTool = defineTool({
      description: "Apifox export OpenAPI runtime",
      execute: async () => null,
      name: "apifox_export_openapi_runtime",
      parameters: z.object({}),
      permission: "mcp.apifox.export_openapi",
    });

    registerTool(externalTool);

    const handler = Object.create(ConversationHandler.prototype) as any;
    handler.allowedTools = undefined;
    handler.mode = undefined;
    handler.additionalToolSchemas = undefined;
    handler.sessionAllowedExternalTools = [];

    expect(handler.getToolsForLlm()["apifox_export_openapi_runtime"]).toBeUndefined();

    const resolution = handler.enableExternalToolForSession("apifox:export_openapi_runtime");
    expect(resolution).toEqual({ status: "unique", toolName: "apifox_export_openapi_runtime" });

    const tools = handler.getToolsForLlm();
    expect(tools["apifox_export_openapi_runtime"]).toBeDefined();
    expect(tools["filesystem-read"]).toBeDefined();

    unregisterTool("apifox_export_openapi_runtime");
  });

  test("tool-search discovery result enables a single external tool for the next LLM tools build", () => {
    const externalTool = defineTool({
      description: "Apifox export OpenAPI discovered",
      execute: async () => null,
      name: "apifox_export_openapi_discovered",
      parameters: z.object({}),
      permission: "mcp.apifox.export_openapi",
    });

    registerTool(externalTool);

    const handler = Object.create(ConversationHandler.prototype) as any;
    handler.allowedTools = undefined;
    handler.mode = undefined;
    handler.additionalToolSchemas = undefined;
    handler.sessionAllowedExternalTools = [];

    const enabled = handler.enableExternalToolsFromDiscoveryResult({
      action: "search",
      query: "apifox export openapi",
      success: true,
      tools: [
        {
          builtin: false,
          description: "Apifox export OpenAPI discovered",
          name: "apifox_export_openapi_discovered",
          permission: "mcp.apifox.export_openapi",
        },
      ],
      total: 1,
    });

    expect(enabled).toEqual(["apifox_export_openapi_discovered"]);
    const tools = handler.getToolsForLlm();
    expect(tools["apifox_export_openapi_discovered"]).toBeDefined();
    expect(tools["filesystem-read"]).toBeDefined();

    unregisterTool("apifox_export_openapi_discovered");
  });

  test("tool-search discovery result enables multiple relevant external tools for the next LLM tools build", () => {
    const first = defineTool({
      description: "GitHub search code discovered",
      execute: async () => null,
      name: "github_search_code_discovered",
      parameters: z.object({}),
      permission: "mcp.github.search_code",
    });
    const second = defineTool({
      description: "ZRead search wiki discovered",
      execute: async () => null,
      name: "zread_search_wiki_discovered",
      parameters: z.object({}),
      permission: "mcp.zread.search_wiki",
    });

    registerTools([first, second]);

    const handler = Object.create(ConversationHandler.prototype) as any;
    handler.allowedTools = undefined;
    handler.mode = undefined;
    handler.additionalToolSchemas = undefined;
    handler.sessionAllowedExternalTools = [];

    const enabled = handler.enableExternalToolsFromDiscoveryResult({
      action: "search",
      query: "search",
      success: true,
      tools: [
        { builtin: false, name: "github_search_code_discovered" },
        { builtin: false, name: "zread_search_wiki_discovered" },
      ],
      total: 2,
    });

    expect(enabled).toEqual(["github_search_code_discovered", "zread_search_wiki_discovered"]);
    expect(handler.sessionAllowedExternalTools).toEqual([
      "github_search_code_discovered",
      "zread_search_wiki_discovered",
    ]);
    expect(handler.getToolsForLlm()["github_search_code_discovered"]).toBeDefined();
    expect(handler.getToolsForLlm()["zread_search_wiki_discovered"]).toBeDefined();

    unregisterTool("github_search_code_discovered");
    unregisterTool("zread_search_wiki_discovered");
  });

  test("tool-search discovery result does not enable external tools in read-only modes", () => {
    const externalTool = defineTool({
      description: "Apifox export readonly discovered",
      execute: async () => null,
      name: "apifox_export_readonly_discovered",
      parameters: z.object({}),
      permission: "mcp.apifox.export",
    });

    registerTool(externalTool);

    const handler = Object.create(ConversationHandler.prototype) as any;
    handler.allowedTools = undefined;
    handler.mode = "plan";
    handler.additionalToolSchemas = undefined;
    handler.sessionAllowedExternalTools = [];

    const enabled = handler.enableExternalToolsFromDiscoveryResult({
      action: "search",
      query: "apifox export",
      success: true,
      tools: [{ builtin: false, name: "apifox_export_readonly_discovered" }],
      total: 1,
    });

    expect(enabled).toEqual([]);
    expect(handler.sessionAllowedExternalTools).toEqual([]);
    expect(handler.getToolsForLlm()["apifox_export_readonly_discovered"]).toBeUndefined();

    unregisterTool("apifox_export_readonly_discovered");
  });

  test("disabled MCP tools stay hidden even when explicitly allowed or discovered", () => {
    const originalXdgConfigHome = process.env.XDG_CONFIG_HOME;
    const tempConfigHome = fs.mkdtempSync(path.join(os.tmpdir(), "crab-disabled-mcp-"));
    const configDir = path.join(tempConfigHome, "crab");
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(
      path.join(configDir, "settings.json"),
      JSON.stringify({ disabledMCPTools: ["apifox:export_disabled"] }),
      "utf8",
    );
    process.env.XDG_CONFIG_HOME = tempConfigHome;

    const externalTool = defineTool({
      description: "Apifox export disabled",
      execute: async () => null,
      name: "apifox_export_disabled",
      parameters: z.object({}),
      permission: "mcp.apifox.export_disabled",
    });

    registerTool(externalTool);
    clearToolsCache();

    try {
      expect(getToolsForAiSdkByNames(["apifox_export_disabled"])["apifox_export_disabled"]).toBeUndefined();

      const handler = Object.create(ConversationHandler.prototype) as any;
      handler.allowedTools = undefined;
      handler.mode = undefined;
      handler.additionalToolSchemas = undefined;
      handler.sessionAllowedExternalTools = [];

      const enabled = handler.enableExternalToolsFromDiscoveryResult({
        action: "search",
        query: "apifox export disabled",
        success: true,
        tools: [{ builtin: false, name: "apifox_export_disabled" }],
        total: 1,
      });

      expect(enabled).toEqual([]);
      expect(handler.sessionAllowedExternalTools).toEqual([]);
      expect(handler.getToolsForLlm()["apifox_export_disabled"]).toBeUndefined();
    } finally {
      unregisterTool("apifox_export_disabled");
      clearToolsCache();
      if (originalXdgConfigHome === undefined) {
        delete process.env.XDG_CONFIG_HOME;
      } else {
        process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
      }
      fs.rmSync(tempConfigHome, { force: true, recursive: true });
    }
  });

  test("disabled MCP tools override opt-in and explicit allow-list exposure", () => {
    const originalXdgConfigHome = process.env.XDG_CONFIG_HOME;
    const tempConfigHome = fs.mkdtempSync(path.join(os.tmpdir(), "crab-mcp-priority-"));
    const configDir = path.join(tempConfigHome, "crab");
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(
      path.join(configDir, "settings.json"),
      JSON.stringify({
        disabledMCPTools: ["apifox:priority_combo"],
        optInMCPTools: ["apifox:priority_combo"],
      }),
      "utf8",
    );
    process.env.XDG_CONFIG_HOME = tempConfigHome;

    const externalTool = defineTool({
      description: "Apifox priority combo",
      execute: async () => null,
      name: "apifox_priority_combo",
      parameters: z.object({}),
      permission: "mcp.apifox.priority_combo",
    });

    registerTool(externalTool);
    clearToolsCache();

    try {
      expect(getToolsForAiSdk()["apifox_priority_combo"]).toBeUndefined();
      expect(getToolsForAiSdkByNames(["apifox_priority_combo"])["apifox_priority_combo"]).toBeUndefined();

      const handler = Object.create(ConversationHandler.prototype) as any;
      handler.allowedTools = ["apifox_priority_combo"];
      handler.mode = undefined;
      handler.additionalToolSchemas = undefined;
      handler.sessionAllowedExternalTools = ["apifox_priority_combo"];

      expect(handler.getToolsForLlm()["apifox_priority_combo"]).toBeUndefined();
    } finally {
      unregisterTool("apifox_priority_combo");
      clearToolsCache();
      if (originalXdgConfigHome === undefined) {
        delete process.env.XDG_CONFIG_HOME;
      } else {
        process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
      }
      fs.rmSync(tempConfigHome, { force: true, recursive: true });
    }
  });

  test("hyphen MCP config keys match underscore-registered external tools", () => {
    const originalXdgConfigHome = process.env.XDG_CONFIG_HOME;
    const tempConfigHome = fs.mkdtempSync(path.join(os.tmpdir(), "crab-mcp-hyphen-"));
    const configDir = path.join(tempConfigHome, "crab");
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(
      path.join(configDir, "settings.json"),
      JSON.stringify({
        disabledMCPTools: ["apifox-blocked-tool"],
        optInMCPTools: ["apifox-visible-tool"],
      }),
      "utf8",
    );
    process.env.XDG_CONFIG_HOME = tempConfigHome;

    const visibleTool = defineTool({
      description: "Apifox visible tool",
      execute: async () => null,
      name: "apifox_visible_tool",
      parameters: z.object({}),
      permission: "mcp.apifox.visible_tool",
    });
    const blockedTool = defineTool({
      description: "Apifox blocked tool",
      execute: async () => null,
      name: "apifox_blocked_tool",
      parameters: z.object({}),
      permission: "mcp.apifox.blocked_tool",
    });

    registerTools([visibleTool, blockedTool]);
    clearToolsCache();

    try {
      expect(getToolsForAiSdk()["apifox_visible_tool"]).toBeDefined();
      expect(getToolsForAiSdkByNames(["apifox-blocked-tool"])["apifox_blocked_tool"]).toBeUndefined();
    } finally {
      unregisterTool("apifox_visible_tool");
      unregisterTool("apifox_blocked_tool");
      clearToolsCache();
      if (originalXdgConfigHome === undefined) {
        delete process.env.XDG_CONFIG_HOME;
      } else {
        process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
      }
      fs.rmSync(tempConfigHome, { force: true, recursive: true });
    }
  });

  test("conversation session does not enable ambiguous external tool names", () => {
    const first = defineTool({
      description: "GitHub search code runtime",
      execute: async () => null,
      name: "github_search_code_runtime",
      parameters: z.object({}),
      permission: "mcp.github.search_code",
    });
    const second = defineTool({
      description: "ZRead search wiki runtime",
      execute: async () => null,
      name: "zread_search_wiki_runtime",
      parameters: z.object({}),
      permission: "mcp.zread.search_wiki",
    });

    registerTools([first, second]);

    const handler = Object.create(ConversationHandler.prototype) as any;
    handler.allowedTools = undefined;
    handler.mode = undefined;
    handler.additionalToolSchemas = undefined;
    handler.sessionAllowedExternalTools = [];

    const resolution = handler.enableExternalToolForSession("search");
    expect(resolution.status).toBe("ambiguous");
    expect(handler.sessionAllowedExternalTools).toEqual([]);
    expect(handler.getToolsForLlm()["github_search_code_runtime"]).toBeUndefined();
    expect(handler.getToolsForLlm()["zread_search_wiki_runtime"]).toBeUndefined();

    unregisterTool("github_search_code_runtime");
    unregisterTool("zread_search_wiki_runtime");
  });

  test("conversation session does not enable external tools in read-only modes", () => {
    const externalTool = defineTool({
      description: "Apifox export in security mode",
      execute: async () => null,
      name: "apifox_export_security_mode",
      parameters: z.object({}),
      permission: "mcp.apifox.export",
    });

    registerTool(externalTool);

    const handler = Object.create(ConversationHandler.prototype) as any;
    handler.allowedTools = undefined;
    handler.mode = "security";
    handler.additionalToolSchemas = undefined;
    handler.sessionAllowedExternalTools = [];

    const resolution = handler.enableExternalToolForSession("apifox:export_security_mode");
    expect(resolution).toEqual({ status: "unique", toolName: "apifox_export_security_mode" });
    expect(handler.sessionAllowedExternalTools).toEqual([]);
    expect(handler.getToolsForLlm()["apifox_export_security_mode"]).toBeUndefined();
    expect(handler.getToolsForLlm()["filesystem-read"]).toBeDefined();

    unregisterTool("apifox_export_security_mode");
  });
});

describe("工具注册表 — 内置工具", () => {
  test("内置 filesystem-read 工具通过懒加载自动注册", () => {
    const tools = getRegisteredTools();
    // FsReadTool 应该在内置工具中
    expect(tools["filesystem-read"]).toBeDefined();
  });
});
