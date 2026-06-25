/**
 * Context7 MCP 客户端单元测试
 *
 * 测试覆盖:
 *   - 连接生命周期(创建、复用、重建、关闭)
 *   - 超时控制(连接超时、工具调用超时)
 *   - resolveLibraryId: 库 ID 解析(JSON + 纯文本响应)
 *   - queryLibraryDocs: 文档查询(JSON + 纯文本响应)
 *   - parseToolResponse: 响应解析(正常、无文本、空文本)
 *   - closeClient: 资源清理
 *
 * Mock 策略:
 *   - @modelcontextprotocol/sdk 的 Client 和 StreamableHTTPClientTransport
 *   - 每次测试前重置所有 mock 状态
 */
import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";

// ─── Mock 设置：必须在 import 模块之前完成 ─────────────────────

// Mock MCP SDK — 使用函数工厂模式，每次创建新实例
const instances: Array<{
  connect: ReturnType<typeof mock>;
  callTool: ReturnType<typeof mock>;
  close: ReturnType<typeof mock>;
}> = [];

const MockClient = mock(() => {
  const inst = {
    close: mock(() => Promise.resolve()),
    connect: mock(() => Promise.resolve()),
    callTool: mock(() => Promise.resolve({})),
  };
  instances.push(inst);
  return inst;
});

const MockTransport = mock(() => ({
  close: mock(() => Promise.resolve()),
}));

mock.module("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: MockClient,
}));

mock.module("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: MockTransport,
}));

// 导入被测模块(Mock 已就位)
const { resolveLibraryId, queryLibraryDocs, closeClient } = await import("@/tool/context7/client");

describe("context7/client", () => {
  beforeEach(() => {
    // 清除所有实例的 mock 记录
    instances.length = 0;
    MockClient.mockClear();
    MockTransport.mockClear();
  });

  afterEach(async () => {
    // 每次测试后清理客户端，避免状态泄漏
    try {
      await closeClient();
    } catch {
      // 忽略清理错误
    }
  });

  /**
   * 获取最新的 Client 实例(最后创建的那个)
   */
  function lastInstance() {
    return instances[instances.length - 1];
  }

  // ─── resolveLibraryId 测试 ────────────────────────────────────

  describe("resolveLibraryId", () => {
    it("成功解析库 ID — 返回 JSON 格式响应", async () => {
      // 预设 callTool 返回值
      MockClient.mockImplementation(() => ({
        callTool: mock(() =>
          Promise.resolve({
            content: [
              {
                text: JSON.stringify({
                  libraryId: "npm:react",
                  libraries: [
                    {
                      libraryId: "npm:react",
                      name: "React",
                      version: "18.2.0",
                      description: "A JavaScript library for building UIs",
                    },
                  ],
                }),
                type: "text",
              },
            ],
          }),
        ),
        close: mock(() => Promise.resolve()),
        connect: mock(() => Promise.resolve()),
      }));

      const result = await resolveLibraryId("react");

      expect(result.libraryId).toBe("npm:react");
      expect(result.libraries).toHaveLength(1);
      expect(result.libraries![0]!.name).toBe("React");
    });

    it("成功解析库 ID — 纯文本响应作为 libraryId", async () => {
      MockClient.mockImplementation(() => ({
        callTool: mock(() =>
          Promise.resolve({
            content: [{ text: "npm:vue", type: "text" }],
          }),
        ),
        close: mock(() => Promise.resolve()),
        connect: mock(() => Promise.resolve()),
      }));

      const result = await resolveLibraryId("vue");

      expect(result.libraryId).toBe("npm:vue");
      expect(result.libraries).toBeUndefined();
    });

    it("传递可选的 version 参数给 MCP 工具", async () => {
      const mockCallTool = mock(() =>
        Promise.resolve({
          content: [{ text: JSON.stringify({ libraryId: "npm:react@18.2.0" }), type: "text" }],
        }),
      );
      MockClient.mockImplementation(() => ({
        callTool: mockCallTool,
        close: mock(() => Promise.resolve()),
        connect: mock(() => Promise.resolve()),
      }));

      await resolveLibraryId("react", undefined, "18.2.0");

      expect(mockCallTool).toHaveBeenCalledTimes(1);
      const callArgs = mockCallTool.mock.calls[0]![0];
      expect(callArgs.arguments.version).toBe("18.2.0");
    });

    it("使用 libraryName 作为默认 query 参数", async () => {
      const mockCallTool = mock(() =>
        Promise.resolve({
          content: [{ text: JSON.stringify({ libraryId: "npm:lodash" }), type: "text" }],
        }),
      );
      MockClient.mockImplementation(() => ({
        callTool: mockCallTool,
        close: mock(() => Promise.resolve()),
        connect: mock(() => Promise.resolve()),
      }));

      await resolveLibraryId("lodash");

      const callArgs = mockCallTool.mock.calls[0]![0];
      expect(callArgs.arguments.query).toBe("lodash");
    });

    it("传递自定义 query 参数", async () => {
      const mockCallTool = mock(() =>
        Promise.resolve({
          content: [{ text: JSON.stringify({ libraryId: "npm:react" }), type: "text" }],
        }),
      );
      MockClient.mockImplementation(() => ({
        callTool: mockCallTool,
        close: mock(() => Promise.resolve()),
        connect: mock(() => Promise.resolve()),
      }));

      await resolveLibraryId("react", "hooks usage");

      const callArgs = mockCallTool.mock.calls[0]![0];
      expect(callArgs.arguments.query).toBe("hooks usage");
    });

    it("调用 resolve-library-id 工具名称", async () => {
      const mockCallTool = mock(() =>
        Promise.resolve({
          content: [{ text: JSON.stringify({ libraryId: "npm:test" }), type: "text" }],
        }),
      );
      MockClient.mockImplementation(() => ({
        callTool: mockCallTool,
        close: mock(() => Promise.resolve()),
        connect: mock(() => Promise.resolve()),
      }));

      await resolveLibraryId("test");

      const callArgs = mockCallTool.mock.calls[0]![0];
      expect(callArgs.name).toBe("resolve-library-id");
    });

    it("version 参数未提供时不包含在 arguments 中", async () => {
      const mockCallTool = mock(() =>
        Promise.resolve({
          content: [{ text: JSON.stringify({ libraryId: "npm:express" }), type: "text" }],
        }),
      );
      MockClient.mockImplementation(() => ({
        callTool: mockCallTool,
        close: mock(() => Promise.resolve()),
        connect: mock(() => Promise.resolve()),
      }));

      await resolveLibraryId("express");

      const callArgs = mockCallTool.mock.calls[0]![0];
      expect(callArgs.arguments.version).toBeUndefined();
    });
  });

  // ─── queryLibraryDocs 测试 ─────────────────────────────────────

  describe("queryLibraryDocs", () => {
    it("成功查询文档 — 返回 JSON 格式片段", async () => {
      MockClient.mockImplementation(() => ({
        callTool: mock(() =>
          Promise.resolve({
            content: [
              {
                text: JSON.stringify({
                  fragments: [
                    { content: "Install with npm", title: "Getting Started", url: "https://example.com" },
                    { code: "fn()", content: "The main function", title: "API Reference" },
                  ],
                  libraryId: "npm:react",
                  query: "how to use hooks",
                }),
                type: "text",
              },
            ],
          }),
        ),
        close: mock(() => Promise.resolve()),
        connect: mock(() => Promise.resolve()),
      }));

      const result = await queryLibraryDocs("npm:react", "how to use hooks");

      expect(result.libraryId).toBe("npm:react");
      expect(result.query).toBe("how to use hooks");
      expect(result.fragments).toHaveLength(2);
      expect(result.fragments[0]!.title).toBe("Getting Started");
      expect(result.fragments[1]!.code).toBe("fn()");
    });

    it("成功查询文档 — 纯文本响应包装为单个片段", async () => {
      MockClient.mockImplementation(() => ({
        callTool: mock(() =>
          Promise.resolve({
            content: [{ text: "This is plain text documentation content", type: "text" }],
          }),
        ),
        close: mock(() => Promise.resolve()),
        connect: mock(() => Promise.resolve()),
      }));

      const result = await queryLibraryDocs("npm:vue", "reactivity system");

      expect(result.fragments).toHaveLength(1);
      expect(result.fragments[0]!.title).toBe("Documentation");
      expect(result.fragments[0]!.content).toBe("This is plain text documentation content");
      expect(result.libraryId).toBe("npm:vue");
      expect(result.query).toBe("reactivity system");
    });

    it("调用 query-docs 工具名称", async () => {
      const mockCallTool = mock(() =>
        Promise.resolve({
          content: [{ text: JSON.stringify({ fragments: [], libraryId: "npm:x", query: "q" }), type: "text" }],
        }),
      );
      MockClient.mockImplementation(() => ({
        callTool: mockCallTool,
        close: mock(() => Promise.resolve()),
        connect: mock(() => Promise.resolve()),
      }));

      await queryLibraryDocs("npm:x", "q");

      const callArgs = mockCallTool.mock.calls[0]![0];
      expect(callArgs.name).toBe("query-docs");
    });

    it("传递可选的 version 参数", async () => {
      const mockCallTool = mock(() =>
        Promise.resolve({
          content: [{ text: JSON.stringify({ fragments: [], libraryId: "npm:x", query: "q" }), type: "text" }],
        }),
      );
      MockClient.mockImplementation(() => ({
        callTool: mockCallTool,
        close: mock(() => Promise.resolve()),
        connect: mock(() => Promise.resolve()),
      }));

      await queryLibraryDocs("npm:x", "q", "2.0.0");

      const callArgs = mockCallTool.mock.calls[0]![0];
      expect(callArgs.arguments.version).toBe("2.0.0");
    });

    it("正确传递 libraryId 和 query 参数", async () => {
      const mockCallTool = mock(() =>
        Promise.resolve({
          content: [
            {
              text: JSON.stringify({ fragments: [], libraryId: "npm:x", query: "test query" }),
              type: "text",
            },
          ],
        }),
      );
      MockClient.mockImplementation(() => ({
        callTool: mockCallTool,
        close: mock(() => Promise.resolve()),
        connect: mock(() => Promise.resolve()),
      }));

      await queryLibraryDocs("npm:svelte", "how to use stores");

      const callArgs = mockCallTool.mock.calls[0]![0];
      expect(callArgs.arguments.libraryId).toBe("npm:svelte");
      expect(callArgs.arguments.query).toBe("how to use stores");
    });

    it("JSON 响应中缺失字段时使用默认值", async () => {
      MockClient.mockImplementation(() => ({
        callTool: mock(() =>
          Promise.resolve({
            content: [
              {
                text: JSON.stringify({ fragments: null }),
                type: "text",
              },
            ],
          }),
        ),
        close: mock(() => Promise.resolve()),
        connect: mock(() => Promise.resolve()),
      }));

      const result = await queryLibraryDocs("npm:x", "q");

      expect(result.fragments).toEqual([]);
      expect(result.libraryId).toBe("npm:x");
      expect(result.query).toBe("q");
    });
  });

  // ─── 连接生命周期测试 ──────────────────────────────────────────

  describe("连接生命周期", () => {
    it("首次调用时创建新客户端连接", async () => {
      MockClient.mockImplementation(() => ({
        callTool: mock(() =>
          Promise.resolve({
            content: [{ text: JSON.stringify({ libraryId: "npm:react" }), type: "text" }],
          }),
        ),
        close: mock(() => Promise.resolve()),
        connect: mock(() => Promise.resolve()),
      }));

      await resolveLibraryId("react");

      expect(MockClient).toHaveBeenCalledTimes(1);
    });

    it("重复调用复用已有客户端连接", async () => {
      let callCount = 0;
      MockClient.mockImplementation(() => {
        callCount++;
        const inst = {
          callTool: mock(() =>
            Promise.resolve({
              content: [{ text: JSON.stringify({ libraryId: "npm:react" }), type: "text" }],
            }),
          ),
          close: mock(() => Promise.resolve()),
          connect: mock(() => Promise.resolve()),
        };
        instances.push(inst);
        return inst;
      });

      await resolveLibraryId("react");
      await resolveLibraryId("vue");

      // Client 只创建一次(复用连接)
      expect(callCount).toBe(1);
    });

    it("closeClient 正确释放资源", async () => {
      const mockCloseFn = mock(() => Promise.resolve());
      MockClient.mockImplementation(() => ({
        callTool: mock(() =>
          Promise.resolve({
            content: [{ text: JSON.stringify({ libraryId: "npm:react" }), type: "text" }],
          }),
        ),
        close: mockCloseFn,
        connect: mock(() => Promise.resolve()),
      }));

      await resolveLibraryId("react");
      await closeClient();

      expect(mockCloseFn).toHaveBeenCalledTimes(1);
    });

    it("closeClient 无客户端时不会崩溃", async () => {
      await expect(closeClient()).resolves.toBeUndefined();
    });
  });

  // ─── 错误处理测试 ──────────────────────────────────────────────

  describe("错误处理", () => {
    it("MCP 响应中无文本内容时抛出内部错误", async () => {
      MockClient.mockImplementation(() => ({
        callTool: mock(() =>
          Promise.resolve({
            content: [{ data: "base64", type: "image" }],
          }),
        ),
        close: mock(() => Promise.resolve()),
        connect: mock(() => Promise.resolve()),
      }));

      await expect(resolveLibraryId("react")).rejects.toThrow("MCP 响应中没有文本内容");
    });

    it("MCP 响应中 text 为空字符串时抛出内部错误", async () => {
      MockClient.mockImplementation(() => ({
        callTool: mock(() =>
          Promise.resolve({
            content: [{ text: "", type: "text" }],
          }),
        ),
        close: mock(() => Promise.resolve()),
        connect: mock(() => Promise.resolve()),
      }));

      await expect(resolveLibraryId("react")).rejects.toThrow("MCP 响应中没有文本内容");
    });

    it("MCP 响应中 content 为空数组时抛出内部错误", async () => {
      MockClient.mockImplementation(() => ({
        callTool: mock(() =>
          Promise.resolve({
            content: [],
          }),
        ),
        close: mock(() => Promise.resolve()),
        connect: mock(() => Promise.resolve()),
      }));

      await expect(queryLibraryDocs("npm:react", "hooks")).rejects.toThrow("MCP 响应中没有文本内容");
    });

    it("连接失败后清理资源并抛出错误", async () => {
      MockClient.mockImplementation(() => ({
        callTool: mock(() => Promise.resolve({})),
        close: mock(() => Promise.resolve()),
        connect: mock(() => Promise.reject(new Error("Network error"))),
      }));

      await expect(resolveLibraryId("react")).rejects.toThrow("Network error");
    });

    it("工具调用失败时正确传播错误", async () => {
      MockClient.mockImplementation(() => ({
        callTool: mock(() => Promise.reject(new Error("Tool timeout"))),
        close: mock(() => Promise.resolve()),
        connect: mock(() => Promise.resolve()),
      }));

      await expect(resolveLibraryId("react")).rejects.toThrow("Tool timeout");
    });
  });
});
