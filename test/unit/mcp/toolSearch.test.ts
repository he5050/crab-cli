/**
 * 工具搜索测试。
 *
 * 测试用例:
 *   - 关键词搜索
 *   - 分类过滤
 *   - 排序策略
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { z } from "zod";
import { defineTool } from "@/tool/types";
import { clearToolsCache, registerTool, unregisterTool } from "@/tool/registry/toolRegistry";
import { searchTools } from "@/tool/executor/toolExecutor";
import { toolSearchTool } from "@/tool/toolSearch";

// 辅助函数:创建测试工具
function makeTool(name: string, description: string) {
  return defineTool({
    description,
    execute: async () => null,
    name,
    parameters: z.object({}),
    permission: "test",
  });
}

describe("searchTools — 模糊搜索", () => {
  beforeEach(() => {
    clearToolsCache();
  });

  test("exact name match has highest score", () => {
    const t1 = makeTool("search_files", "Search files in directory");
    const t2 = makeTool("search_web", "Search the web");

    const results = searchTools("search_files", {
      search_files: t1,
      search_web: t2,
    });

    expect(results[0]!.name).toBe("search_files");
  });

  test("prefix match ranks higher than substring match", () => {
    const t1 = makeTool("file_read", "Read file contents");
    const t2 = makeTool("search_file", "Search in files");

    const results = searchTools("file", {
      file_read: t1,
      search_file: t2,
    });

    // File_read starts with "file", should rank higher
    expect(results[0]!.name).toBe("file_read");
  });

  test("描述匹配返回结果", () => {
    const t1 = makeTool("tool_a", "Delete files from disk");
    const t2 = makeTool("tool_b", "Create new files");

    const results = searchTools("delete", {
      tool_a: t1,
      tool_b: t2,
    });

    expect(results).toHaveLength(1);
    expect(results[0]!.name).toBe("tool_a");
  });

  test("fuzzy character match returns results", () => {
    const t1 = makeTool("search_repositories", "Search repos");
    const t2 = makeTool("create_issue", "Create an issue");

    const results = searchTools("srchrepo", {
      create_issue: t2,
      search_repositories: t1,
    });

    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]!.name).toBe("search_repositories");
  });

  test("无匹配返回空数组", () => {
    const t1 = makeTool("abc", "Tool abc");
    const results = searchTools("xyznotfound", { abc: t1 });
    expect(results).toHaveLength(0);
  });

  test("大小写不敏感搜索", () => {
    const t1 = makeTool("MyTool", "A tool");

    const results = searchTools("mytool", { MyTool: t1 });
    expect(results).toHaveLength(1);
    expect(results[0]!.name).toBe("MyTool");
  });

  test("results are sorted by score descending", () => {
    const tools: Record<string, ReturnType<typeof makeTool>> = {};
    // Exact match
    tools["terminal"] = makeTool("terminal", "Terminal tool");
    // Prefix match
    tools["terminal_execute"] = makeTool("terminal_execute", "Execute in terminal");
    // Substring match
    tools["my_terminal_tool"] = makeTool("my_terminal_tool", "Another terminal");
    // Description match
    tools["desc_term"] = makeTool("desc_term", "A terminal-related tool");

    const results = searchTools("terminal", tools);

    // Exact match first
    expect(results[0]!.name).toBe("terminal");
    // All should be found
    expect(results.length).toBe(4);
  });

  test("搜索使用已注册工具当无工具参数", () => {
    const tool = makeTool("search_reg_test", "Search registered test");
    registerTool(tool);

    const results = searchTools("search_reg_test");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some((t) => t.name === "search_reg_test")).toBe(true);

    unregisterTool("search_reg_test");
  });
});

describe("tool-search 工具执行分支", () => {
  beforeEach(() => {
    clearToolsCache();
  });

  test("无参数返回工具分组摘要", async () => {
    const result = (await toolSearchTool.execute({} as any, {} as any)) as any;

    expect(result.success).toBe(true);
    expect(result.action).toBe("summary");
    expect(result.totalTools).toBeGreaterThan(0);
    expect(result.totalGroups).toBeGreaterThan(0);
    expect(result.groups.some((group: any) => group.name === "filesystem")).toBe(true);
  });

  test("listAll 返回已注册工具和内置分组", async () => {
    const result = (await toolSearchTool.execute({ listAll: true } as any, {} as any)) as any;

    expect(result.success).toBe(true);
    expect(result.action).toBe("list_all");
    expect(result.total).toBeGreaterThan(0);
    expect(result.tools.some((tool: any) => tool.name === "tool-search" && tool.builtin === true)).toBe(true);
    expect(result.groups.some((group: any) => group.name === "deepwiki")).toBe(true);
  });

  test("group 按内置分组过滤并可返回参数摘要", async () => {
    const result = (await toolSearchTool.execute({ group: "deepwiki", verbose: true } as any, {} as any)) as any;

    expect(result.success).toBe(true);
    expect(result.action).toBe("search_by_group");
    expect(result.group).toBe("deepwiki");
    expect(result.tools.some((tool: any) => tool.name === "deepwiki-fetch" && tool.parameters)).toBe(true);
  });

  test("未知 group 返回可用分组错误", async () => {
    const result = (await toolSearchTool.execute({ group: "missing-group" } as any, {} as any)) as any;

    expect(result.success).toBe(false);
    expect(result.error).toContain("分组不存在: missing-group");
    expect(result.error).toContain("filesystem");
  });

  test("query 搜索返回匹配工具并支持 verbose 参数摘要", async () => {
    const result = (await toolSearchTool.execute({ query: "deepwiki-fetch", verbose: true } as any, {} as any)) as any;

    expect(result.success).toBe(true);
    expect(result.action).toBe("search");
    expect(result.query).toBe("deepwiki-fetch");
    expect(result.tools.some((tool: any) => tool.name === "deepwiki-fetch" && tool.parameters)).toBe(true);
  });
});
