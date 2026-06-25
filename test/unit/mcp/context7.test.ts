/**
 * Context7 工具测试。
 *
 * 测试用例:
 *   - 库文档查询
 *   - API 检索
 *   - 代码示例获取
 */
import { describe, expect, test } from "bun:test";
import {
  context7QueryDocsTool,
  context7ResolveLibraryIdTool,
  queryLibraryDocs,
  resolveLibraryId,
} from "@/tool/context7";

describe("Context7 工具 - 客户端函数", () => {
  test("resolveLibraryId 解析库 ID", async () => {
    const result = await resolveLibraryId("react");
    expect(result).toHaveProperty("libraryId");
    expect(result.libraryId.length).toBeGreaterThan(0);
  }, 30_000);

  test("queryLibraryDocs 查询文档", async () => {
    // 先获取 libraryId
    const { libraryId } = await resolveLibraryId("react");
    expect(libraryId).toBeDefined();

    // 查询文档
    const result = await queryLibraryDocs(libraryId, "useEffect hook");
    expect(result).toHaveProperty("fragments");
    expect(result).toHaveProperty("libraryId");
    expect(result).toHaveProperty("query");
    expect(Array.isArray(result.fragments)).toBe(true);
  }, 30_000);
});

describe("Context7 resolve_library_id 工具", () => {
  test("工具定义正确", () => {
    expect(context7ResolveLibraryIdTool.name).toBe("context7-resolve-library-id");
    expect(context7ResolveLibraryIdTool.permission).toBe("web.fetch");
    expect(context7ResolveLibraryIdTool.parameters).toBeDefined();
  });

  test("解析 React 库 ID", async () => {
    const result = (await context7ResolveLibraryIdTool.execute(
      { libraryName: "react" },
      {
        messageId: "test-message",
        metadata: (title, meta) => {
          console.log(`[${title}]`, meta);
        },
        sessionId: "test-session",
      },
    )) as any;

    expect(result.status).toBe("ok");
    expect(result.libraryId).toBeDefined();
    expect(result.libraryId?.length).toBeGreaterThan(0);
    expect(result.error).toBeUndefined();
  }, 30_000);

  test("支持版本参数", async () => {
    const result = (await context7ResolveLibraryIdTool.execute(
      { libraryName: "react", version: "18.2.0" },
      {
        messageId: "test-message",
        sessionId: "test-session",
      },
    )) as any;

    expect(result.status).toBe("ok");
    expect(result.libraryId).toBeDefined();
  }, 30_000);
});

describe("Context7 query_docs 工具", () => {
  test("工具定义正确", () => {
    expect(context7QueryDocsTool.name).toBe("context7-query-docs");
    expect(context7QueryDocsTool.permission).toBe("web.fetch");
    expect(context7QueryDocsTool.parameters).toBeDefined();
  });

  test("查询 React useEffect 文档", async () => {
    // 先解析 libraryId
    const resolveResult = await resolveLibraryId("react");
    expect(resolveResult.libraryId).toBeDefined();

    const result = (await context7QueryDocsTool.execute(
      {
        libraryId: resolveResult.libraryId,
        query: "useEffect hook example",
      },
      {
        messageId: "test-message",
        metadata: (title, meta) => {
          console.log(`[${title}]`, meta);
        },
        sessionId: "test-session",
      },
    )) as any;

    expect(result.status).toBe("ok");
    expect(result.fragments).toBeDefined();
    expect(result.fragments?.length).toBeGreaterThan(0);
    expect(result.libraryId).toBe(resolveResult.libraryId);
    expect(result.query).toBe("useEffect hook example");
  }, 30_000);

  test("支持中文查询", async () => {
    const resolveResult = await resolveLibraryId("react");

    const result = (await context7QueryDocsTool.execute(
      {
        libraryId: resolveResult.libraryId,
        query: "useRef 是什么",
      },
      {
        messageId: "test-message",
        sessionId: "test-session",
      },
    )) as any;

    expect(result.status).toBe("ok");
    expect(result.fragments?.length).toBeGreaterThan(0);
  }, 30_000);
});
