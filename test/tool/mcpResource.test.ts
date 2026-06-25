/**
 * MCP 资源访问工具测试 — list_mcp_resources 和 read_mcp_resource。
 *
 * 测试覆盖:
 *   - 工具定义结构(name, description, parameters, permission, builtin)
 *   - 内置工具分组注册(isBuiltinTool, getBuiltinGroupName)
 *   - list_mcp_resources: 空结果、按服务器过滤、格式化输出
 *   - read_mcp_resource: 正常读取、错误处理、内容格式化
 *   - 工具注册表集成(工具已注册且可通过 getTool 获取)
 */
import { describe, expect, it, spyOn, beforeEach, afterEach } from "bun:test";
import { listMcpResourcesTool } from "@/tool/mcp/listResources";
import { readMcpResourceTool } from "@/tool/mcp/readResource";
import { isBuiltinTool, getBuiltinGroupName, getBuiltinToolGroups } from "@/tool/registry/builtinGroups";
import { getTool, getRegisteredTools } from "@/tool/registry/toolRegistry";
import * as mcpRuntime from "@/mcp/manager/runtime";

describe("MCP 资源访问工具 — 工具定义", () => {
  it("listMcpResourcesTool 应有正确的工具定义", () => {
    expect(listMcpResourcesTool.name).toBe("mcp_list_resources");
    expect(listMcpResourcesTool.permission).toBe("mcp.read");
    expect(listMcpResourcesTool.builtin).toBe(true);
    expect(listMcpResourcesTool.description).toContain("MCP");
    expect(listMcpResourcesTool.description).toContain("资源");
    expect(listMcpResourcesTool.parameters).toBeDefined();
  });

  it("readMcpResourceTool 应有正确的工具定义", () => {
    expect(readMcpResourceTool.name).toBe("mcp_read_resource");
    expect(readMcpResourceTool.permission).toBe("mcp.read");
    expect(readMcpResourceTool.builtin).toBe(true);
    expect(readMcpResourceTool.description).toContain("MCP");
    expect(readMcpResourceTool.description).toContain("资源");
    expect(readMcpResourceTool.parameters).toBeDefined();
  });

  it("readMcpResourceTool 参数应包含 server 和 uri 必填字段", () => {
    const shape = readMcpResourceTool.parameters.shape as Record<string, { isOptional: () => boolean }>;
    expect(shape.server).toBeDefined();
    expect(shape.uri).toBeDefined();
    // server 和 uri 是必填的
    expect(shape.server!.isOptional()).toBe(false);
    expect(shape.uri!.isOptional()).toBe(false);
  });

  it("listMcpResourcesTool 参数应包含可选的 server 字段", () => {
    const shape = listMcpResourcesTool.parameters.shape as Record<string, { isOptional: () => boolean }>;
    expect(shape.server).toBeDefined();
    expect(shape.server!.isOptional()).toBe(true);
  });
});

describe("MCP 资源访问工具 — 内置分组注册", () => {
  it("mcp_list_resources 应被识别为内置工具", () => {
    expect(isBuiltinTool("mcp_list_resources")).toBe(true);
  });

  it("mcp_read_resource 应被识别为内置工具", () => {
    expect(isBuiltinTool("mcp_read_resource")).toBe(true);
  });

  it("mcp_list_resources 应属于 'mcp' 分组", () => {
    expect(getBuiltinGroupName("mcp_list_resources")).toBe("mcp");
  });

  it("mcp_read_resource 应属于 'mcp' 分组", () => {
    expect(getBuiltinGroupName("mcp_read_resource")).toBe("mcp");
  });

  it("内置工具分组列表应包含 mcp 分组", () => {
    const groups = getBuiltinToolGroups();
    const mcpGroup = groups.find((g) => g.name === "mcp");
    expect(mcpGroup).toBeDefined();
    expect(mcpGroup?.tools).toContain("mcp_list_resources");
    expect(mcpGroup?.tools).toContain("mcp_read_resource");
  });
});

describe("MCP 资源访问工具 — 工具注册表集成", () => {
  it("mcp_list_resources 应在工具注册表中", () => {
    const tool = getTool("mcp_list_resources");
    expect(tool).toBeDefined();
    expect(tool?.name).toBe("mcp_list_resources");
  });

  it("mcp_read_resource 应在工具注册表中", () => {
    const tool = getTool("mcp_read_resource");
    expect(tool).toBeDefined();
    expect(tool?.name).toBe("mcp_read_resource");
  });

  it("getRegisteredTools 应包含 MCP 资源工具", () => {
    const tools = getRegisteredTools();
    expect(tools["mcp_list_resources"]).toBeDefined();
    expect(tools["mcp_read_resource"]).toBeDefined();
  });
});

describe("listMcpResourcesTool — 执行逻辑", () => {
  let spy: ReturnType<typeof spyOn>;

  afterEach(() => {
    if (spy) {
      spy.mockRestore();
    }
  });

  it("无资源时应返回提示信息", async () => {
    spy = spyOn(mcpRuntime, "getMcpRuntimeResources").mockResolvedValue([]);

    const result = await listMcpResourcesTool.execute({});

    expect(result).toContain("没有可用的资源");
  });

  it("指定服务器无资源时应返回提示信息", async () => {
    spy = spyOn(mcpRuntime, "getMcpRuntimeResources").mockResolvedValue([]);

    const result = await listMcpResourcesTool.execute({ server: "nonexistent" });

    expect(result).toContain("没有可用的资源");
    expect(result).toContain("nonexistent");
  });

  it("有资源时应返回格式化的资源列表", async () => {
    const mockResources = [
      {
        server: "test-server",
        name: "config.json",
        uri: "file:///config.json",
        description: "配置文件",
        mimeType: "application/json",
      },
      {
        server: "test-server",
        name: "data.csv",
        uri: "file:///data.csv",
        mimeType: "text/csv",
      },
    ];

    spy = spyOn(mcpRuntime, "getMcpRuntimeResources").mockResolvedValue(mockResources);

    const result = (await listMcpResourcesTool.execute({})) as string;

    expect(result).toContain("MCP 资源列表");
    expect(result).toContain("test-server");
    expect(result).toContain("config.json");
    expect(result).toContain("file:///config.json");
    expect(result).toContain("application/json");
    expect(result).toContain("配置文件");
    expect(result).toContain("data.csv");
  });

  it("按服务器名称过滤应只返回匹配的资源", async () => {
    const mockResources = [
      { server: "server-a", name: "resource-a", uri: "file:///a" },
      { server: "server-b", name: "resource-b", uri: "file:///b" },
    ];

    spy = spyOn(mcpRuntime, "getMcpRuntimeResources").mockResolvedValue(mockResources);

    const result = (await listMcpResourcesTool.execute({ server: "server-a" })) as string;

    expect(result).toContain("server-a");
    expect(result).toContain("resource-a");
    expect(result).not.toContain("server-b");
    expect(result).not.toContain("resource-b");
  });

  it("多服务器资源应按服务器分组显示", async () => {
    const mockResources = [
      { server: "server-a", name: "resource-a", uri: "file:///a" },
      { server: "server-b", name: "resource-b", uri: "file:///b" },
    ];

    spy = spyOn(mcpRuntime, "getMcpRuntimeResources").mockResolvedValue(mockResources);

    const result = (await listMcpResourcesTool.execute({})) as string;

    expect(result).toContain("【server-a】");
    expect(result).toContain("【server-b】");
  });

  it("运行时错误应返回错误信息", async () => {
    spy = spyOn(mcpRuntime, "getMcpRuntimeResources").mockRejectedValue(new Error("Connection refused"));

    const result = (await listMcpResourcesTool.execute({})) as string;

    expect(result).toContain("失败");
    expect(result).toContain("Connection refused");
  });
});

describe("readMcpResourceTool — 执行逻辑", () => {
  let spy: ReturnType<typeof spyOn>;

  afterEach(() => {
    if (spy) {
      spy.mockRestore();
    }
  });

  it("应正确读取并格式化资源内容", async () => {
    const mockResult = {
      contents: [
        {
          uri: "file:///config.json",
          mimeType: "application/json",
          text: '{"key": "value"}',
        },
      ],
    };

    spy = spyOn(mcpRuntime, "readMcpRuntimeResource").mockResolvedValue(mockResult);

    const result = (await readMcpResourceTool.execute({
      server: "test-server",
      uri: "file:///config.json",
    })) as string;

    expect(result).toContain("file:///config.json");
    expect(result).toContain("application/json");
    expect(result).toContain('{"key": "value"}');
  });

  it("多个内容块应用分隔符分隔", async () => {
    const mockResult = {
      contents: [
        { uri: "file:///a", text: "content-a" },
        { uri: "file:///b", text: "content-b" },
      ],
    };

    spy = spyOn(mcpRuntime, "readMcpRuntimeResource").mockResolvedValue(mockResult);

    const result = (await readMcpResourceTool.execute({
      server: "test-server",
      uri: "file:///a",
    })) as string;

    expect(result).toContain("content-a");
    expect(result).toContain("content-b");
    expect(result).toContain("---");
  });

  it("无 contents 结构时应返回序列化结果", async () => {
    const mockResult = { someData: "value" };

    spy = spyOn(mcpRuntime, "readMcpRuntimeResource").mockResolvedValue(mockResult);

    const result = (await readMcpResourceTool.execute({
      server: "test-server",
      uri: "file:///data",
    })) as string;

    expect(result).toContain("someData");
    expect(result).toContain("value");
  });

  it("字符串结果应直接返回", async () => {
    spy = spyOn(mcpRuntime, "readMcpRuntimeResource").mockResolvedValue("plain text content" as any);

    const result = (await readMcpResourceTool.execute({
      server: "test-server",
      uri: "file:///text",
    })) as string;

    expect(result).toBe("plain text content");
  });

  it("空 contents 数组应返回序列化结果", async () => {
    const mockResult = { contents: [] };

    spy = spyOn(mcpRuntime, "readMcpRuntimeResource").mockResolvedValue(mockResult as any);

    const result = (await readMcpResourceTool.execute({
      server: "test-server",
      uri: "file:///empty",
    })) as string;

    // 空数组兜底到 JSON.stringify
    expect(result).toContain("contents");
  });

  it("运行时错误应返回错误信息", async () => {
    spy = spyOn(mcpRuntime, "readMcpRuntimeResource").mockRejectedValue(new Error("Server not connected"));

    const result = (await readMcpResourceTool.execute({
      server: "test-server",
      uri: "file:///config.json",
    })) as string;

    expect(result).toContain("失败");
    expect(result).toContain("Server not connected");
  });

  it("内容块为字符串时应直接使用", async () => {
    const mockResult = {
      contents: ["raw-string-content"],
    };

    spy = spyOn(mcpRuntime, "readMcpRuntimeResource").mockResolvedValue(mockResult as any);

    const result = (await readMcpResourceTool.execute({
      server: "test-server",
      uri: "file:///raw",
    })) as string;

    expect(result).toContain("raw-string-content");
  });
});
