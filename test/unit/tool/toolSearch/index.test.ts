/**
 * toolSearch 工具模块单元测试
 *
 * 测试策略:
 *   toolSearchTool 依赖 toolRegistry → toolExecutor 深层链，
 *   Bun mock.module 无法完整覆盖传递依赖。
 *   因此仅测试:
 *     1. 参数 schema 验证 (zod safeParse)
 *     2. 工具名/描述搜索匹配逻辑 (纯函数提取测试)
 */
import { describe, it, expect } from "bun:test";
import { z } from "zod";

// ─── 复用与源码相同的 schema 定义 ──────────────────────────────
const ToolSearchParams = z.object({
  group: z.string().optional().describe("按工具分组筛选"),
  listAll: z.boolean().optional().describe("列出所有已注册的工具"),
  query: z.string().optional().describe("搜索查询"),
  verbose: z.boolean().optional().describe("显示完整参数 schema"),
});

// ═══════════════════════════════════════════════════════════════════
// 参数 schema 验证
// ═══════════════════════════════════════════════════════════════════
describe("toolSearch 参数 schema", () => {
  it("空参数通过验证", () => {
    expect(ToolSearchParams.safeParse({}).success).toBe(true);
  });

  it("仅 query 通过验证", () => {
    expect(ToolSearchParams.safeParse({ query: "git" }).success).toBe(true);
  });

  it("仅 listAll=true 通过验证", () => {
    expect(ToolSearchParams.safeParse({ listAll: true }).success).toBe(true);
  });

  it("仅 group 通过验证", () => {
    expect(ToolSearchParams.safeParse({ group: "filesystem" }).success).toBe(true);
  });

  it("仅 verbose=true 通过验证", () => {
    expect(ToolSearchParams.safeParse({ verbose: true }).success).toBe(true);
  });

  it("所有参数组合通过验证", () => {
    expect(
      ToolSearchParams.safeParse({
        group: "terminal",
        listAll: false,
        query: "bash",
        verbose: true,
      }).success,
    ).toBe(true);
  });

  it("未知字段被剥离", () => {
    const result = ToolSearchParams.safeParse({ query: "test", unknown: "field" });
    expect(result.success).toBe(true);
    expect((result as any).data.unknown).toBeUndefined();
  });

  it("query 为非字符串应失败", () => {
    expect(ToolSearchParams.safeParse({ query: 123 }).success).toBe(false);
  });

  it("listAll 为非布尔值应失败", () => {
    expect(ToolSearchParams.safeParse({ listAll: "true" }).success).toBe(false);
  });

  it("group 为非字符串应失败", () => {
    expect(ToolSearchParams.safeParse({ group: 42 }).success).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 搜索匹配逻辑（模拟 toolSearch 内部的 fuzzy match 行为）
// ═══════════════════════════════════════════════════════════════════

/** 模拟工具搜索匹配逻辑 — 与源码 toolSearchTool.execute 中一致的模糊匹配 */
function matchTool(tool: { name: string; description: string }, query: string): boolean {
  const q = query.toLowerCase();
  return tool.name.toLowerCase().includes(q) || tool.description.toLowerCase().includes(q);
}

describe("搜索匹配逻辑", () => {
  const tools = [
    { description: "执行 bash 命令", name: "terminal-execute" },
    { description: "读取文件内容", name: "filesystem-read" },
    { description: "写入文件内容", name: "filesystem-write" },
    { description: "编辑文件部分内容", name: "filesystem-edit" },
    { description: "搜索网页内容", name: "websearch" },
    { description: "抓取 URL 内容", name: "webfetch" },
  ];

  it("按名称搜索: filesystem 命中 3 个工具", () => {
    const results = tools.filter((t) => matchTool(t, "filesystem"));
    expect(results).toHaveLength(3);
  });

  it("按描述搜索: 文件 命中 3 个工具", () => {
    const results = tools.filter((t) => matchTool(t, "文件"));
    expect(results).toHaveLength(3);
  });

  it("按名称精确搜索: webfetch", () => {
    const results = tools.filter((t) => matchTool(t, "webfetch"));
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("webfetch");
  });

  it("不区分大小写", () => {
    const results = tools.filter((t) => matchTool(t, "FILESYSTEM"));
    expect(results).toHaveLength(3);
  });

  it("无匹配返回空", () => {
    const results = tools.filter((t) => matchTool(t, "nonexistent"));
    expect(results).toHaveLength(0);
  });

  it("空 query 应匹配所有", () => {
    const results = tools.filter((t) => matchTool(t, ""));
    expect(results).toHaveLength(tools.length);
  });

  it("按分组筛选: filesystem 组", () => {
    const filesystemTools = tools.filter((t) => t.name.startsWith("filesystem-"));
    expect(filesystemTools).toHaveLength(3);
  });
});
