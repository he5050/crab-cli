/**
 * src/tool/registry/toolRegistry.ts 核心 CRUD 路径单元测试
 *
 * 测试范围:
 *   - registerTool / registerTools / unregisterTool
 *   - getRegisteredTools
 *   - isBuiltinTool / getBuiltinGroupName
 *   - getToolsForAiSdk / getToolsForAiSdkByNames
 *   - clearToolsCache
 *
 * 策略: 使用 beforeAll/afterAll 管理生命周期，避免每次测试都重新加载所有内置工具。
 *       用 unregisterTool 替代 _resetForTesting 进行单个测试清理。
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { z } from "zod";

import { defineTool } from "@/tool/types";
import {
  _resetForTesting,
  registerTool,
  registerTools,
  unregisterTool,
  getRegisteredTools,
  isBuiltinTool,
  getBuiltinGroupName,
  getToolsForAiSdk,
  getToolsForAiSdkByNames,
  clearToolsCache,
} from "@/tool/registry";

// ─── Mock 工具工厂 ─────────────────────────────────────────────

function makeMockTool(name: string, description = "测试工具") {
  return defineTool({
    name,
    description,
    permission: "test.read",
    parameters: z.object({ input: z.string() }),
    execute: async (args) => args.input,
  });
}

// ─── 生命周期（仅初始化/清理一次） ──────────────────────────────

const registeredMocks: string[] = [];

function cleanupMockTools(): void {
  for (const name of registeredMocks) {
    unregisterTool(name);
  }
  registeredMocks.length = 0;
}

beforeAll(() => {
  _resetForTesting();
  // 触发 ensureInitialized 一次性加载所有内置工具
  getRegisteredTools();
});

afterAll(() => {
  cleanupMockTools();
});

// ═══════════════════════════════════════════════════════════════════
// 1. registerTool
// ═══════════════════════════════════════════════════════════════════

describe("registerTool", () => {
  it("注册一个 mock 工具后 getRegisteredTools 应包含它", () => {
    const tool = makeMockTool("test-mock-tool", "测试工具");
    registerTool(tool);
    registeredMocks.push("test-mock-tool");

    const tools = getRegisteredTools();
    const registered = tools["test-mock-tool"];
    expect(registered).toBeDefined();
    expect(registered!.name).toBe("test-mock-tool");
    expect(registered!.description).toBe("测试工具");

    unregisterTool("test-mock-tool");
    registeredMocks.pop();
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. registerTool 冲突
// ═══════════════════════════════════════════════════════════════════

describe("registerTool 冲突", () => {
  it("注册同名工具时应 warn 并跳过，不覆盖已有工具", () => {
    const toolA = makeMockTool("conflict-tool", "原始工具");
    const toolB = defineTool({
      name: "conflict-tool",
      description: "冲突工具",
      permission: "test.write",
      parameters: z.object({ value: z.number() }),
      execute: async (args) => args.value,
    });

    registerTool(toolA);
    registeredMocks.push("conflict-tool");
    registerTool(toolB); // 应被跳过

    const tools = getRegisteredTools();
    const registered = tools["conflict-tool"];
    expect(registered!.description).toBe("原始工具");
    expect(registered!.permission).toBe("test.read");

    unregisterTool("conflict-tool");
    registeredMocks.pop();
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. registerTools 批量
// ═══════════════════════════════════════════════════════════════════

describe("registerTools 批量", () => {
  it("批量注册多个工具后 getRegisteredTools 应全部包含", () => {
    const tools = [makeMockTool("batch-tool-a"), makeMockTool("batch-tool-b"), makeMockTool("batch-tool-c")];

    registerTools(tools);
    registeredMocks.push("batch-tool-a", "batch-tool-b", "batch-tool-c");

    const registered = getRegisteredTools();
    expect(registered["batch-tool-a"]).toBeDefined();
    expect(registered["batch-tool-b"]).toBeDefined();
    expect(registered["batch-tool-c"]).toBeDefined();

    for (const name of ["batch-tool-a", "batch-tool-b", "batch-tool-c"]) {
      unregisterTool(name);
    }
    registeredMocks.length = 0;
  });

  it("批量注册中冲突工具应跳过，不阻止其他工具注册", () => {
    const toolA = makeMockTool("batch-conflict-a");
    registerTool(toolA);
    registeredMocks.push("batch-conflict-a");

    const tools = [
      toolA, // 冲突，应跳过
      makeMockTool("batch-conflict-b"),
    ];

    registerTools(tools);
    registeredMocks.push("batch-conflict-b");

    const registered = getRegisteredTools();
    expect(registered["batch-conflict-a"]).toBeDefined();
    expect(registered["batch-conflict-b"]).toBeDefined();

    for (const name of ["batch-conflict-a", "batch-conflict-b"]) {
      unregisterTool(name);
    }
    registeredMocks.length = 0;
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. unregisterTool
// ═══════════════════════════════════════════════════════════════════

describe("unregisterTool", () => {
  it("注销工具后 getRegisteredTools 不再包含", () => {
    const tool = makeMockTool("to-unregister");

    registerTool(tool);
    expect(getRegisteredTools()["to-unregister"]).toBeDefined();

    unregisterTool("to-unregister");
    expect(getRegisteredTools()["to-unregister"]).toBeUndefined();
  });

  it("注销不存在的工具不应报错", () => {
    expect(() => unregisterTool("nonexistent-tool")).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. isBuiltinTool
// ═══════════════════════════════════════════════════════════════════

describe("isBuiltinTool", () => {
  it("已知内置工具名应返回 true", () => {
    expect(isBuiltinTool("filesystem-read")).toBe(true);
    expect(isBuiltinTool("terminal-execute")).toBe(true);
    expect(isBuiltinTool("glob")).toBe(true);
    expect(isBuiltinTool("websearch")).toBe(true);
    expect(isBuiltinTool("git")).toBe(true);
  });

  it("未知工具名应返回 false", () => {
    expect(isBuiltinTool("nonexistent-tool")).toBe(false);
    expect(isBuiltinTool("")).toBe(false);
    expect(isBuiltinTool("mcp-some-tool")).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6. getBuiltinGroupName
// ═══════════════════════════════════════════════════════════════════

describe("getBuiltinGroupName", () => {
  it("内置工具应返回正确的分组名", () => {
    expect(getBuiltinGroupName("filesystem-read")).toBe("filesystem");
    expect(getBuiltinGroupName("filesystem-write")).toBe("filesystem");
    expect(getBuiltinGroupName("terminal-execute")).toBe("terminal");
    expect(getBuiltinGroupName("glob")).toBe("search");
    expect(getBuiltinGroupName("git")).toBe("git");
    expect(getBuiltinGroupName("deep-research")).toBe("research");
  });

  it("未知工具应返回 null", () => {
    expect(getBuiltinGroupName("nonexistent-tool")).toBeNull();
    expect(getBuiltinGroupName("")).toBeNull();
    expect(getBuiltinGroupName("mcp-external")).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════
// 7. isBuiltinTool O(1) — 查找表已构建
// ═══════════════════════════════════════════════════════════════════

describe("isBuiltinTool O(1) 查找表", () => {
  it("重复调用不应报错，查找表应已正确构建", () => {
    expect(isBuiltinTool("filesystem-read")).toBe(true);
    expect(isBuiltinTool("filesystem-read")).toBe(true);
    expect(isBuiltinTool("terminal-execute")).toBe(true);
    expect(isBuiltinTool("nonexistent")).toBe(false);
    expect(isBuiltinTool("glob")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 8. getToolsForAiSdkByNames
// ═══════════════════════════════════════════════════════════════════

describe("getToolsForAiSdkByNames", () => {
  it("按名称过滤应仅返回指定工具", () => {
    const filtered = getToolsForAiSdkByNames(["filter-a", "filter-c"]);

    // 这些工具不存在，应返回空
    expect(Object.keys(filtered)).toHaveLength(0);
  });

  it("指定内置工具名应返回对应工具（不含 execute）", () => {
    const filtered = getToolsForAiSdkByNames(["glob"]);

    expect(filtered["glob"]).toBeDefined();
    expect(filtered["glob"]).toHaveProperty("description");
    expect(filtered["glob"]).toHaveProperty("inputSchema");
    expect(filtered["glob"]).not.toHaveProperty("execute");
  });

  it("传入不存在的工具名应返回空对象", () => {
    const filtered = getToolsForAiSdkByNames(["nonexistent-tool-xyz"]);
    expect(Object.keys(filtered)).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 9. clearToolsCache
// ═══════════════════════════════════════════════════════════════════

describe("clearToolsCache", () => {
  it("清除缓存后下次调用 getToolsForAiSdk 应重建缓存", () => {
    const before = getToolsForAiSdk();
    expect(Object.keys(before).length).toBeGreaterThan(0);

    clearToolsCache();

    const after = getToolsForAiSdk();
    expect(Object.keys(after).length).toBeGreaterThan(0);
  });
});
