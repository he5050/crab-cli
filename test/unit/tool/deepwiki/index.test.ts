/**
 * DeepWiki 集成单元测试
 *
 * 测试覆盖:
 *   - normalizeRepoName: 仓库名规范化
 *   - readWikiStructure: 文档结构获取(JSON + 纯文本响应)
 *   - readWikiContents: 文档内容读取
 *   - askQuestion: 基于文档问答
 *   - htmlToMarkdown: HTML 转 Markdown
 *   - extractLinks: 链接提取
 *   - crawl: 爬取逻辑
 *   - normalizeUrl / resolveRepo: URL 规范化和仓库解析
 *   - closeClient: 资源清理
 *
 * Mock 策略:
 *   - @modelcontextprotocol/sdk 的 Client 和 StreamableHTTPClientTransport
 *   - fetch (GitHub API)
 */
import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";

// ─── Mock MCP SDK ──────────────────────────────────────────────

const MockClient = mock(() => ({
  close: mock(() => Promise.resolve()),
  connect: mock(() => Promise.resolve()),
  callTool: mock(() => Promise.resolve({})),
}));

const MockTransport = mock(() => ({
  close: mock(() => Promise.resolve()),
}));

mock.module("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: MockClient,
}));

mock.module("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: MockTransport,
}));

// 导入被测模块
const { normalizeRepoName, readWikiStructure, readWikiContents, askQuestion, closeClient } =
  await import("@/tool/deepwiki/client");

const { htmlToMarkdown } = await import("@/tool/deepwiki/htmlToMarkdown");

const { normalizeUrl, resolveRepo } = await import("@/tool/deepwiki/utils");

const { crawl } = await import("@/tool/deepwiki/crawler");

/**
 * 创建一个指定 callTool 行为的 MockClient 实现
 */
function createClientMock(callToolFn: () => Promise<unknown>) {
  return () => ({
    callTool: callToolFn,
    close: mock(() => Promise.resolve()),
    connect: mock(() => Promise.resolve()),
  });
}

describe("deepwiki", () => {
  beforeEach(() => {
    MockClient.mockClear();
    MockTransport.mockClear();
  });

  afterEach(async () => {
    try {
      await closeClient();
    } catch {
      // 忽略清理错误
    }
  });

  // ─── normalizeRepoName 测试 ───────────────────────────────────

  describe("normalizeRepoName", () => {
    it("规范化 owner/repo 格式", () => {
      expect(normalizeRepoName("facebook/react")).toBe("facebook/react");
    });

    it("移除 https://github.com/ 前缀", () => {
      expect(normalizeRepoName("https://github.com/facebook/react")).toBe("facebook/react");
    });

    it("移除前后斜杠", () => {
      expect(normalizeRepoName("/facebook/react/")).toBe("facebook/react");
    });

    it("处理带前后空格的输入", () => {
      expect(normalizeRepoName("  facebook/react  ")).toBe("facebook/react");
    });

    it("处理完整的 GitHub URL 带前后空格和斜杠", () => {
      expect(normalizeRepoName("  https://github.com/vuejs/core/  ")).toBe("vuejs/core");
    });

    it("处理带多个前导斜杠的输入", () => {
      expect(normalizeRepoName("///facebook/react")).toBe("facebook/react");
    });
  });

  // ─── readWikiStructure 测试 ───────────────────────────────────

  describe("readWikiStructure", () => {
    it("成功获取文档结构 — JSON 格式响应", async () => {
      MockClient.mockImplementation(
        createClientMock(() =>
          Promise.resolve({
            content: [
              {
                text: JSON.stringify({
                  structure: [
                    { name: "Getting Started", path: "getting-started", type: "file" },
                    {
                      children: [
                        { name: "API Reference", path: "docs/api", type: "file" },
                        { name: "Changelog", path: "docs/changelog", type: "file" },
                      ],
                      name: "docs",
                      path: "docs",
                      type: "directory",
                    },
                  ],
                }),
                type: "text",
              },
            ],
          }),
        ),
      );

      const structure = await readWikiStructure("facebook/react");

      expect(structure).toHaveLength(2);
      expect(structure[0]!.name).toBe("Getting Started");
      expect(structure[1]!.type).toBe("directory");
      expect(structure[1]!.children).toHaveLength(2);
    });

    it("成功获取文档结构 — 纯文本响应返回模拟结构", async () => {
      MockClient.mockImplementation(
        createClientMock(() =>
          Promise.resolve({
            content: [{ text: "Some plain text documentation", type: "text" }],
          }),
        ),
      );

      const structure = await readWikiStructure("facebook/react");

      // 纯文本响应返回单个 README 文件
      expect(structure).toHaveLength(1);
      expect(structure[0]!.name).toBe("README");
      expect(structure[0]!.type).toBe("file");
    });

    it("JSON 响应中 structure 为空数组时返回空数组", async () => {
      MockClient.mockImplementation(
        createClientMock(() =>
          Promise.resolve({
            content: [{ text: JSON.stringify({ structure: [] }), type: "text" }],
          }),
        ),
      );

      const structure = await readWikiStructure("some/repo");

      expect(structure).toEqual([]);
    });

    it("使用规范化后的仓库名调用 MCP 工具", async () => {
      const mockCallTool = mock(() =>
        Promise.resolve({
          content: [{ text: JSON.stringify({ structure: [] }), type: "text" }],
        }),
      );
      MockClient.mockImplementation(() => ({
        callTool: mockCallTool,
        close: mock(() => Promise.resolve()),
        connect: mock(() => Promise.resolve()),
      }));

      await readWikiStructure("https://github.com/vuejs/core");

      const callArgs = mockCallTool.mock.calls[0]![0];
      expect(callArgs.arguments.repoName).toBe("vuejs/core");
    });

    it("调用 deepwiki-read-structure 工具名称", async () => {
      const mockCallTool = mock(() =>
        Promise.resolve({
          content: [{ text: JSON.stringify({ structure: [] }), type: "text" }],
        }),
      );
      MockClient.mockImplementation(() => ({
        callTool: mockCallTool,
        close: mock(() => Promise.resolve()),
        connect: mock(() => Promise.resolve()),
      }));

      await readWikiStructure("owner/repo");

      const callArgs = mockCallTool.mock.calls[0]![0];
      expect(callArgs.name).toBe("deepwiki-read-structure");
    });
  });

  // ─── readWikiContents 测试 ───────────────────────────────────

  describe("readWikiContents", () => {
    it("成功读取文档内容", async () => {
      MockClient.mockImplementation(
        createClientMock(() =>
          Promise.resolve({
            content: [
              {
                text: "# Getting Started\n\nThis is the content of the documentation.",
                type: "text",
              },
            ],
          }),
        ),
      );

      const result = await readWikiContents("facebook/react", "docs/getting-started");

      expect(result.content).toContain("# Getting Started");
      expect(result.path).toBe("docs/getting-started");
      expect(result.repoName).toBe("facebook/react");
    });

    it("规范化仓库名后调用 MCP 工具", async () => {
      const mockCallTool = mock(() =>
        Promise.resolve({
          content: [{ text: "Documentation content", type: "text" }],
        }),
      );
      MockClient.mockImplementation(() => ({
        callTool: mockCallTool,
        close: mock(() => Promise.resolve()),
        connect: mock(() => Promise.resolve()),
      }));

      await readWikiContents("https://github.com/vuejs/core", "docs/intro");

      const callArgs = mockCallTool.mock.calls[0]![0];
      expect(callArgs.arguments.repoName).toBe("vuejs/core");
      expect(callArgs.arguments.path).toBe("docs/intro");
    });

    it("调用 deepwiki-read-contents 工具名称", async () => {
      const mockCallTool = mock(() =>
        Promise.resolve({
          content: [{ text: "content", type: "text" }],
        }),
      );
      MockClient.mockImplementation(() => ({
        callTool: mockCallTool,
        close: mock(() => Promise.resolve()),
        connect: mock(() => Promise.resolve()),
      }));

      await readWikiContents("owner/repo", "README");

      const callArgs = mockCallTool.mock.calls[0]![0];
      expect(callArgs.name).toBe("deepwiki-read-contents");
    });

    it("MCP 响应无文本时抛出内部错误", async () => {
      MockClient.mockImplementation(
        createClientMock(() =>
          Promise.resolve({
            content: [{ data: "base64", type: "image" }],
          }),
        ),
      );

      await expect(readWikiContents("owner/repo", "README")).rejects.toThrow("MCP 响应中没有文本内容");
    });
  });

  // ─── askQuestion 测试 ─────────────────────────────────────────

  describe("askQuestion", () => {
    it("成功获取问答结果", async () => {
      MockClient.mockImplementation(
        createClientMock(() =>
          Promise.resolve({
            content: [
              {
                text: "React hooks are functions that let you use state in functional components.",
                type: "text",
              },
            ],
          }),
        ),
      );

      const result = await askQuestion("facebook/react", "What are hooks?");

      expect(result.answer).toContain("React hooks");
      expect(result.question).toBe("What are hooks?");
      expect(result.repoName).toBe("facebook/react");
    });

    it("规范化仓库名后调用 MCP 工具", async () => {
      const mockCallTool = mock(() =>
        Promise.resolve({
          content: [{ text: "The answer is...", type: "text" }],
        }),
      );
      MockClient.mockImplementation(() => ({
        callTool: mockCallTool,
        close: mock(() => Promise.resolve()),
        connect: mock(() => Promise.resolve()),
      }));

      await askQuestion("https://github.com/vuejs/core", "How to use computed?");

      const callArgs = mockCallTool.mock.calls[0]![0];
      expect(callArgs.arguments.repoName).toBe("vuejs/core");
      expect(callArgs.arguments.question).toBe("How to use computed?");
    });

    it("调用 deepwiki-ask-question 工具名称", async () => {
      const mockCallTool = mock(() =>
        Promise.resolve({
          content: [{ text: "answer", type: "text" }],
        }),
      );
      MockClient.mockImplementation(() => ({
        callTool: mockCallTool,
        close: mock(() => Promise.resolve()),
        connect: mock(() => Promise.resolve()),
      }));

      await askQuestion("owner/repo", "question?");

      const callArgs = mockCallTool.mock.calls[0]![0];
      expect(callArgs.name).toBe("deepwiki-ask-question");
    });
  });

  // ─── 连接生命周期测试 ─────────────────────────────────────────

  describe("连接生命周期", () => {
    it("首次调用时创建新客户端", async () => {
      MockClient.mockImplementation(
        createClientMock(() =>
          Promise.resolve({
            content: [{ text: JSON.stringify({ structure: [] }), type: "text" }],
          }),
        ),
      );

      await readWikiStructure("facebook/react");

      expect(MockClient).toHaveBeenCalledTimes(1);
    });

    it("重复调用复用已有客户端", async () => {
      let callCount = 0;
      MockClient.mockImplementation(() => {
        callCount++;
        return {
          callTool: mock(() =>
            Promise.resolve({
              content: [{ text: "content", type: "text" }],
            }),
          ),
          close: mock(() => Promise.resolve()),
          connect: mock(() => Promise.resolve()),
        };
      });

      await readWikiStructure("facebook/react");
      await readWikiContents("facebook/react", "docs");
      await askQuestion("facebook/react", "question?");

      // 只创建一次 Client
      expect(callCount).toBe(1);
    });

    it("closeClient 正确释放资源", async () => {
      const mockCloseFn = mock(() => Promise.resolve());
      MockClient.mockImplementation(() => ({
        callTool: mock(() =>
          Promise.resolve({
            content: [{ text: JSON.stringify({ structure: [] }), type: "text" }],
          }),
        ),
        close: mockCloseFn,
        connect: mock(() => Promise.resolve()),
      }));

      await readWikiStructure("facebook/react");
      await closeClient();

      expect(mockCloseFn).toHaveBeenCalledTimes(1);
    });

    it("closeClient 无客户端时不会崩溃", async () => {
      await expect(closeClient()).resolves.toBeUndefined();
    });
  });

  // ─── htmlToMarkdown 测试 ───────────────────────────────────────

  describe("htmlToMarkdown", () => {
    it("转换 h1 标签为 Markdown 标题", async () => {
      const result = await htmlToMarkdown("<h1>Title</h1>");
      expect(result).toContain("# Title");
    });

    it("转换 h2-h6 标签为对应级别的 Markdown 标题", async () => {
      const result = await htmlToMarkdown("<h2>Sub</h2><h3>SubSub</h3>");
      expect(result).toContain("## Sub");
      expect(result).toContain("### SubSub");
    });

    it("转换粗体和斜体标签", async () => {
      const result = await htmlToMarkdown("<strong>bold</strong> and <em>italic</em>");
      expect(result).toContain("**bold**");
      expect(result).toContain("*italic*");
    });

    it("转换链接标签", async () => {
      const result = await htmlToMarkdown('<a href="https://example.com">link</a>');
      expect(result).toContain("[link](https://example.com)");
    });

    it("移除 script 和 style 标签", async () => {
      const result = await htmlToMarkdown("<script>alert('x')</script><style>body{color:red}</style><p>Hello</p>");
      expect(result).not.toContain("script");
      expect(result).not.toContain("style");
      expect(result).toContain("Hello");
    });

    it("转换 HTML 表格为 Markdown 表格", async () => {
      const html = `<table>
        <tr><th>Name</th><th>Age</th></tr>
        <tr><td>Alice</td><td>30</td></tr>
      </table>`;
      const result = await htmlToMarkdown(html);
      expect(result).toContain("| Name | Age |");
      expect(result).toContain("| --- | --- |");
      expect(result).toContain("| Alice | 30 |");
    });

    it("解码 HTML 实体", async () => {
      const result = await htmlToMarkdown("a &lt; b &amp;&amp; c &gt; d");
      expect(result).toContain("a < b && c > d");
    });

    it("转换代码标签", async () => {
      const result = await htmlToMarkdown("<code>inline</code>");
      expect(result).toContain("`inline`");
    });

    it("转换预格式化标签", async () => {
      const result = await htmlToMarkdown("<pre>block code</pre>");
      expect(result).toContain("```\nblock code\n```");
    });

    it("转换列表标签", async () => {
      const result = await htmlToMarkdown("<ul><li>Item 1</li><li>Item 2</li></ul>");
      expect(result).toContain("- Item 1");
      expect(result).toContain("- Item 2");
    });

    it("清理多余空白", async () => {
      const result = await htmlToMarkdown("<p>A</p>\n\n\n\n\n<p>B</p>");
      // 不会有多于 2 个连续换行
      expect(result).not.toContain("\n\n\n");
    });
  });

  // ─── normalizeUrl 测试 ─────────────────────────────────────────

  describe("normalizeUrl", () => {
    it("返回完整的 HTTPS URL 原样", async () => {
      const result = await normalizeUrl("https://deepwiki.com/facebook/react");
      expect(result).toBe("https://deepwiki.com/facebook/react");
    });

    it("将 owner/repo 格式补全为完整 URL", async () => {
      const result = await normalizeUrl("facebook/react");
      expect(result).toBe("https://deepwiki.com/facebook/react");
    });

    it("对无效格式返回 null", async () => {
      const result = await normalizeUrl("a/b/c/d");
      expect(result).toBeNull();
    });
  });

  // ─── resolveRepo 测试 ─────────────────────────────────────────

  describe("resolveRepo", () => {
    it("通过 GitHub API 解析仓库名", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = mock(() =>
        Promise.resolve({
          json: () =>
            Promise.resolve({
              items: [{ full_name: "facebook/react" }],
            }),
          ok: true,
        } as Response),
      );

      const repo = await resolveRepo("react");
      expect(repo).toBe("facebook/react");

      globalThis.fetch = originalFetch;
    });

    it("GitHub API 返回错误时抛出异常", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = mock(() =>
        Promise.resolve({
          ok: false,
          status: 403,
        } as Response),
      );

      await expect(resolveRepo("react")).rejects.toThrow();
      globalThis.fetch = originalFetch;
    });

    it("GitHub API 无匹配结果时抛出异常", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = mock(() =>
        Promise.resolve({
          json: () => Promise.resolve({ items: [] }),
          ok: true,
        } as Response),
      );

      await expect(resolveRepo("nonexistent-repo-xyz-123")).rejects.toThrow();
      globalThis.fetch = originalFetch;
    });
  });

  // ─── crawl 测试 ───────────────────────────────────────────────

  describe("crawl", () => {
    it("maxDepth=0 时只爬取入口页面", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          text: () => Promise.resolve('<html><body><h1>Test Page</h1><a href="/page2">Link</a></body></html>'),
        } as Response),
      );

      const result = await crawl({
        maxDepth: 0,
        root: new URL("https://deepwiki.com/owner/repo"),
      });

      // maxDepth=0 只爬取入口页，不跟踪链接
      expect(result.urls).toHaveLength(1);
      expect(result.urls[0]).toBe("https://deepwiki.com/owner/repo");
      expect(Object.keys(result.html)).toHaveLength(1);

      globalThis.fetch = originalFetch;
    });

    it("emit 回调在每次获取页面时被调用", async () => {
      const originalFetch = globalThis.fetch;
      const emittedEvents: Array<{ type: string; url: string }> = [];

      globalThis.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          text: () => Promise.resolve("<html><body>No links</body></html>"),
        } as Response),
      );

      await crawl({
        emit: (event) => {
          emittedEvents.push({ type: event.type, url: event.url });
        },
        maxDepth: 0,
        root: new URL("https://deepwiki.com/owner/repo"),
      });

      expect(emittedEvents.length).toBe(1);
      expect(emittedEvents[0]!.type).toBe("fetch");
      expect(emittedEvents[0]!.url).toBe("https://deepwiki.com/owner/repo");

      globalThis.fetch = originalFetch;
    });

    it("页面获取失败时不崩溃", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = mock(() =>
        Promise.resolve({
          ok: false,
          status: 404,
        } as Response),
      );

      const result = await crawl({
        maxDepth: 0,
        root: new URL("https://deepwiki.com/owner/repo"),
      });

      // 页面获取失败但不应崩溃
      expect(result.urls).toHaveLength(1);
      expect(Object.keys(result.html)).toHaveLength(0);

      globalThis.fetch = originalFetch;
    });

    it("fetch 抛出异常时不崩溃", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = mock(() => Promise.reject(new Error("Network error")));

      const result = await crawl({
        maxDepth: 0,
        root: new URL("https://deepwiki.com/owner/repo"),
      });

      expect(result.urls).toHaveLength(1);
      expect(Object.keys(result.html)).toHaveLength(0);

      globalThis.fetch = originalFetch;
    });
  });
});
