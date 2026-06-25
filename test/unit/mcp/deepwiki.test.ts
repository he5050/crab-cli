/**
 * DeepWiki 工具测试。
 *
 * 测试用例:
 *   - 文档获取
 *   - 内容解析
 *   - 缓存策略
 */
import { afterEach, describe, expect, test } from "bun:test";
import {
  askQuestion,
  deepwikiAskQuestionTool,
  deepwikiFetchTool,
  deepwikiReadContentsTool,
  deepwikiReadStructureTool,
  deepwikiSearchTool,
  normalizeRepoName,
  readWikiContents,
  readWikiStructure,
} from "@/tool/deepwiki";
import { htmlToMarkdown } from "@/tool/deepwiki/htmlToMarkdown";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("DeepWiki 工具 - 客户端函数", () => {
  test("normalizeRepoName 正确规范化仓库名", () => {
    expect(normalizeRepoName("facebook/react")).toBe("facebook/react");
    expect(normalizeRepoName("https://github.com/facebook/react")).toBe("facebook/react");
    expect(normalizeRepoName("/facebook/react/")).toBe("facebook/react");
    expect(normalizeRepoName("  facebook/react  ")).toBe("facebook/react");
  });

  test("readWikiStructure 获取文档结构", async () => {
    const structure = await readWikiStructure("facebook/react");
    expect(Array.isArray(structure)).toBe(true);
    expect(structure.length).toBeGreaterThan(0);

    // 验证结构项格式
    const firstItem = structure[0]!;
    expect(firstItem).toHaveProperty("name");
    expect(firstItem).toHaveProperty("path");
    expect(firstItem).toHaveProperty("type");
    expect(["file", "directory"]).toContain(firstItem.type);
  }, 90_000);

  test("readWikiContents 读取文档内容", async () => {
    // 先获取结构
    const structure = await readWikiStructure("facebook/react");
    expect(structure.length).toBeGreaterThan(0);

    // 找一个文件类型的项
    const fileItem = structure.find((item) => item.type === "file");
    if (!fileItem) {
      console.log("未找到文件类型项，跳过内容读取测试");
      return;
    }

    const result = await readWikiContents("facebook/react", fileItem.path);
    expect(result).toHaveProperty("content");
    expect(result).toHaveProperty("path");
    expect(result).toHaveProperty("repoName");
    expect(result.content.length).toBeGreaterThan(0);
  }, 90_000);

  test("askQuestion 回答问题", async () => {
    const result = await askQuestion("facebook/react", "What is React used for?");
    expect(result).toHaveProperty("answer");
    expect(result).toHaveProperty("question");
    expect(result).toHaveProperty("repoName");
    expect(result.answer.length).toBeGreaterThan(0);
    expect(result.question).toBe("What is React used for?");
  }, 90_000);
});

describe("DeepWiki read_structure 工具", () => {
  test("工具定义正确", () => {
    expect(deepwikiReadStructureTool.name).toBe("deepwiki-read-structure");
    expect(deepwikiReadStructureTool.permission).toBe("web.fetch");
    expect(deepwikiReadStructureTool.parameters).toBeDefined();
  });

  test("获取文档结构", async () => {
    const result = (await deepwikiReadStructureTool.execute(
      { repoName: "facebook/react" },
      {
        messageId: "test-message",
        metadata: (title, meta) => {
          console.log(`[${title}]`, meta);
        },
        sessionId: "test-session",
      },
    )) as any;

    expect(result.status).toBe("ok");
    expect(result.structure).toBeDefined();
    expect(result.structure?.length).toBeGreaterThan(0);
    expect(result.error).toBeUndefined();
  }, 30_000);

  test("支持完整 GitHub URL", async () => {
    const result = (await deepwikiReadStructureTool.execute(
      { repoName: "https://github.com/facebook/react" },
      {
        messageId: "test-message",
        sessionId: "test-session",
      },
    )) as any;

    expect(result.status).toBe("ok");
    expect(result.structure?.length).toBeGreaterThan(0);
  }, 30_000);
});

describe("DeepWiki read_contents 工具", () => {
  test("工具定义正确", () => {
    expect(deepwikiReadContentsTool.name).toBe("deepwiki-read-contents");
    expect(deepwikiReadContentsTool.permission).toBe("web.fetch");
  });

  test("读取文档内容", async () => {
    // 先获取结构
    const structure = await readWikiStructure("facebook/react");
    const fileItem = structure.find((item) => item.type === "file");

    if (!fileItem) {
      console.log("未找到文件类型项，跳过测试");
      return;
    }

    const result = (await deepwikiReadContentsTool.execute(
      { path: fileItem.path, repoName: "facebook/react" },
      {
        messageId: "test-message",
        metadata: (title, meta) => {
          console.log(`[${title}]`, meta);
        },
        sessionId: "test-session",
      },
    )) as any;

    expect(result.status).toBe("ok");
    expect(result.content).toBeDefined();
    expect(result.content?.length).toBeGreaterThan(0);
    expect(result.path).toBe(fileItem.path);
    expect(result.repoName).toBe("facebook/react");
  }, 30_000);
});

describe("DeepWiki ask_question 工具", () => {
  test("工具定义正确", () => {
    expect(deepwikiAskQuestionTool.name).toBe("deepwiki-ask-question");
    expect(deepwikiAskQuestionTool.permission).toBe("web.fetch");
  });

  test("基于文档回答问题", async () => {
    const result = (await deepwikiAskQuestionTool.execute(
      { question: "What is React?", repoName: "facebook/react" },
      {
        messageId: "test-message",
        metadata: (title, meta) => {
          console.log(`[${title}]`, meta);
        },
        sessionId: "test-session",
      },
    )) as any;

    expect(result.status).toBe("ok");
    expect(result.answer).toBeDefined();
    expect(result.answer?.length).toBeGreaterThan(0);
    expect(result.question).toBe("What is React?");
    expect(result.repoName).toBe("facebook/react");
  }, 30_000);

  test("支持中文问题", async () => {
    const result = (await deepwikiAskQuestionTool.execute(
      { question: "React 是什么？", repoName: "facebook/react" },
      {
        messageId: "test-message",
        sessionId: "test-session",
      },
    )) as any;

    expect(result.status).toBe("ok");
    expect(result.answer?.length).toBeGreaterThan(0);
  }, 30_000);
});

describe("DeepWiki fetch/search 离线边界", () => {
  test("htmlToMarkdown 移除脚本样式并转换常见标签、实体和表格", async () => {
    const markdown = await htmlToMarkdown(`
      <style>.hidden { display: none; }</style>
      <script>alert("x")</script>
      <h1>Title &amp; More</h1>
      <p><strong>Bold</strong> and <em>italic</em> with <a href="https://example.com">link</a></p>
      <img src="/logo.png" alt="Logo">
      <table><tr><th>Name</th><th>Value</th></tr><tr><td>A</td><td>&lt;1&gt;</td></tr></table>
      <blockquote>Quote</blockquote>
      <hr>
    `);

    expect(markdown).toContain("# Title & More");
    expect(markdown).toContain("**Bold** and *italic* with [link](https://example.com)");
    expect(markdown).toContain("![Logo](/logo.png)");
    expect(markdown).toContain("| Name | Value |");
    expect(markdown).toContain("| A | <1> |");
    expect(markdown).toContain("> Quote");
    expect(markdown).not.toContain("alert");
    expect(markdown).not.toContain("display: none");
  });

  test("deepwiki-fetch 拒绝非 deepwiki.com 域名", async () => {
    const result = (await deepwikiFetchTool.execute(
      { maxDepth: 0, mode: "pages", url: "https://example.com/owner/repo", verbose: false },
      { messageId: "test-message", sessionId: "test-session" },
    )) as any;

    expect(result.status).toBe("error");
    expect(result.pages).toEqual([]);
    expect(result.error).toBe("只允许 deepwiki.com 域名");
  });

  test("deepwiki-fetch 使用爬虫结果转换多页 Markdown", async () => {
    const seenUrls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      seenUrls.push(url);
      if (url.endsWith("/owner/repo")) {
        return new Response(`<h1>Root</h1><a href="/owner/repo/page">Next</a>`, { status: 200 });
      }
      if (url.endsWith("/owner/repo/page")) {
        return new Response(`<h2>Page</h2><p>DeepWiki content</p>`, { status: 200 });
      }
      return new Response("missing", { status: 404 });
    }) as any;

    const metadata: { title: string; meta: unknown }[] = [];
    const result = (await deepwikiFetchTool.execute(
      { maxDepth: 1, mode: "pages", url: "owner/repo", verbose: true },
      {
        messageId: "test-message",
        metadata: (title, meta) => metadata.push({ meta, title }),
        sessionId: "test-session",
      },
    )) as any;

    expect(result.status).toBe("ok");
    expect(result.pages).toHaveLength(2);
    expect(result.pages.map((page: any) => page.markdown).join("\n")).toContain("# Root");
    expect(result.pages.map((page: any) => page.markdown).join("\n")).toContain("## Page");
    expect(seenUrls).toEqual(["https://deepwiki.com/owner/repo", "https://deepwiki.com/owner/repo/page"]);
    expect(metadata.map((item) => item.title)).toEqual([
      "正在解析 DeepWiki URL...",
      "正在爬取文档...",
      "正在转换 Markdown...",
      "文档获取完成",
    ]);
  });

  test("deepwiki-search 转义查询正则并限制匹配数量", async () => {
    globalThis.fetch = (async () => new Response("<h1>Search</h1><p>Use React? for UI.</p>", { status: 200 })) as any;

    const result = (await deepwikiSearchTool.execute(
      { maxDepth: 0, maxMatches: 2, mode: "pages", query: "React?", url: "owner/repo", verbose: false },
      { messageId: "test-message", sessionId: "test-session" },
    )) as any;

    expect(result.status).toBe("ok");
    expect(result.query).toBe("React?");
    expect(result.totalSearchedPages).toBe(1);
    expect(result.matches).toHaveLength(2);
    expect(result.matches[0].snippet).toContain("**React?**");
  });

  test("deepwiki-search 在爬虫无内容时返回错误", async () => {
    globalThis.fetch = (async () => new Response("missing", { status: 404 })) as any;

    const result = (await deepwikiSearchTool.execute(
      { maxDepth: 0, maxMatches: 10, mode: "pages", query: "anything", url: "owner/repo", verbose: false },
      { messageId: "test-message", sessionId: "test-session" },
    )) as any;

    expect(result.status).toBe("error");
    expect(result.matches).toEqual([]);
    expect(result.totalSearchedPages).toBe(0);
    expect(result.error).toBe("未能获取任何页面内容");
  });
});
