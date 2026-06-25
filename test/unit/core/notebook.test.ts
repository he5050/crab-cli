/**
 * 笔记本(Notebook)工具测试(L4-T09/T10)。
 *
 * 测试目标:
 *   - 验证 Notebook 工具的文件读写、路径解析、清理逻辑
 *
 * 测试用例:
 *   - 新建 / 读取 / 写入 / 删除笔记本条目
 *   - 路径不存在与权限错误的处理
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, unlinkSync } from "node:fs";
import path from "node:path";

describe("Notebook Tool (L4-T09~T10)", () => {
  const tmpDir = path.join(process.cwd(), ".test-notebook");
  const notebooksDir = path.join(tmpDir, ".crab", "notebooks");

  beforeEach(() => {
    mock.restore();
    rmSync(tmpDir, { force: true, recursive: true });
    mkdirSync(notebooksDir, { recursive: true });
  });

  function mockModules() {
    mock.module("@core/logger", () => ({
      createLogger: () => ({ debug: () => {}, error: () => {}, info: () => {}, warn: () => {} }),
    }));
  }

  test("T09: 创建笔记返回 entry 含 id 和时间戳", async () => {
    mockModules();

    const mod = await import("@/tool/notebook/index.ts");
    const result = (await mod.notebookTool.execute({
      action: "create",
      content: "笔记内容",
      projectDir: tmpDir,
      sessionId: "s1",
      title: "测试笔记",
    })) as {
      success: boolean;
      entry: { id: string; title: string; content: string; tags: string[]; createdAt: string };
      total: number;
    };

    expect(result.success).toBe(true);
    expect(result.entry.id).toBeTruthy();
    expect(result.entry.title).toBe("测试笔记");
    expect(result.entry.content).toBe("笔记内容");
    expect(result.entry.tags).toEqual([]);
    expect(result.entry.createdAt).toBeTruthy();
    expect(result.total).toBe(1);
  });

  test("T09: 读取不存在的笔记返回错误", async () => {
    mockModules();

    const mod = await import("@/tool/notebook/index.ts");
    const result = (await mod.notebookTool.execute({
      action: "read",
      noteId: "non-existent",
      sessionId: "s1",
    })) as { success: boolean; error: string };

    expect(result.success).toBe(false);
    expect(result.error).toContain("不存在");
  });

  test("T09: 更新笔记修改 title/content/tags", async () => {
    mockModules();

    const mod = await import("@/tool/notebook/index.ts");

    // 先创建
    const createResult = (await mod.notebookTool.execute({
      action: "create",
      content: "原内容",
      sessionId: "s1",
      title: "原标题",
    })) as { success: boolean; entry: { id: string } };
    const noteId = createResult.entry.id;

    // 更新
    const updateResult = (await mod.notebookTool.execute({
      action: "update",
      content: "新内容",
      noteId,
      sessionId: "s1",
      tags: ["tag1", "tag2"],
      title: "新标题",
    })) as { success: boolean; entry: { title: string; content: string; tags: string[] } };

    expect(updateResult.success).toBe(true);
    expect(updateResult.entry.title).toBe("新标题");
    expect(updateResult.entry.content).toBe("新内容");
    expect(updateResult.entry.tags).toEqual(["tag1", "tag2"]);
  });

  test("T09: 删除笔记后列表不再包含", async () => {
    mockModules();

    const mod = await import("@/tool/notebook/index.ts");

    // 使用独立 sessionId 避免模块级 Map 缓存残留
    await mod.notebookTool.execute({
      action: "create",
      sessionId: "s1-delete",
      title: "待删除",
    });
    await mod.notebookTool.execute({
      action: "create",
      sessionId: "s1-delete",
      title: "保留",
    });

    const listBefore = (await mod.notebookTool.execute({ action: "list", sessionId: "s1-delete" })) as {
      total: number;
      entries: { id: string }[];
    };
    expect(listBefore.total).toBe(2);

    // 获取第一个笔记 ID 来删除
    const firstNoteId = listBefore.entries[0]!.id;
    const delResult = (await mod.notebookTool.execute({
      action: "delete",
      noteId: firstNoteId,
      sessionId: "s1-delete",
    })) as { success: boolean };
    expect(delResult.success).toBe(true);

    const listAfter = (await mod.notebookTool.execute({ action: "list", sessionId: "s1-delete" })) as { total: number };
    expect(listAfter.total).toBe(1);
  });

  test("T10: 搜索按标题、内容、标签匹配", async () => {
    mockModules();

    const mod = await import("@/tool/notebook/index.ts");

    await mod.notebookTool.execute({
      action: "create",
      content: "RESTful 接口设计",
      sessionId: "s-search",
      tags: ["api", "design"],
      title: "API设计笔记",
    });
    await mod.notebookTool.execute({
      action: "create",
      content: "使用 PostgreSQL",
      sessionId: "s-search",
      tags: ["db"],
      title: "数据库方案",
    });

    // 按标题搜索
    const titleSearch = (await mod.notebookTool.execute({
      action: "search",
      query: "API",
      sessionId: "s-search",
    })) as { success: boolean; results: { title: string }[] };
    expect(titleSearch.success).toBe(true);
    expect(titleSearch.results.length).toBe(1);
    expect(titleSearch.results[0]!.title).toBe("API设计笔记");

    // 按标签搜索
    const tagSearch = (await mod.notebookTool.execute({
      action: "search",
      query: "api",
      sessionId: "s-search",
    })) as { results: unknown[] };
    expect(tagSearch.results.length).toBe(1);

    // 按内容搜索
    const contentSearch = (await mod.notebookTool.execute({
      action: "search",
      query: "PostgreSQL",
      sessionId: "s-search",
    })) as { results: unknown[] };
    expect(contentSearch.results.length).toBe(1);

    // 无匹配
    const noMatch = (await mod.notebookTool.execute({
      action: "search",
      query: "不存在",
      sessionId: "s-search",
    })) as { results: unknown[] };
    expect(noMatch.results.length).toBe(0);
  });

  test("T10: 正则搜索支持", async () => {
    mockModules();

    const mod = await import("@/tool/notebook/index.ts");

    await mod.notebookTool.execute({
      action: "create",
      content: "修复登录bug",
      sessionId: "s-regex",
      tags: ["bugfix"],
      title: "Issue #123 修复",
    });
    await mod.notebookTool.execute({
      action: "create",
      content: "新增导出功能",
      sessionId: "s-regex",
      title: "Issue #456 新功能",
    });

    // 正则匹配 Issue #数字
    const regexResult = (await mod.notebookTool.execute({
      action: "search",
      query: "/Issue #\\d+/",
      sessionId: "s-regex",
    })) as { success: boolean; results: unknown[] };
    expect(regexResult.success).toBe(true);
    expect(regexResult.results.length).toBe(2);

    // 无效正则返回错误
    const invalidRegex = (await mod.notebookTool.execute({
      action: "search",
      query: "/[invalid(",
      sessionId: "s-regex",
    })) as { success: boolean; results: unknown[] };
    // 无效正则返回空结果而非错误
    expect(invalidRegex.success).toBe(true);
    expect(invalidRegex.results.length).toBe(0);
  });

  test("T10: 会话隔离 — 不同 sessionId 笔记互不可见", async () => {
    mockModules();

    const mod = await import("@/tool/notebook/index.ts");

    // 在 s-a 创建笔记
    await mod.notebookTool.execute({
      action: "create",
      sessionId: "s-a",
      title: "A的笔记",
    });

    // 在 s-b 创建笔记
    await mod.notebookTool.execute({
      action: "create",
      sessionId: "s-b",
      title: "B的笔记",
    });

    // S-a 只能看到自己的笔记
    const listA = (await mod.notebookTool.execute({ action: "list", sessionId: "s-a" })) as {
      total: number;
      entries: { title: string }[];
    };
    expect(listA.total).toBe(1);
    expect(listA.entries[0]!.title).toBe("A的笔记");

    // S-b 只能看到自己的笔记
    const listB = (await mod.notebookTool.execute({ action: "list", sessionId: "s-b" })) as {
      total: number;
      entries: { title: string }[];
    };
    expect(listB.total).toBe(1);
    expect(listB.entries[0]!.title).toBe("B的笔记");
  });

  test("T10: 持久化到磁盘文件", async () => {
    mockModules();

    const mod = await import("@/tool/notebook/index.ts");

    await mod.notebookTool.execute({
      action: "create",
      content: "磁盘存储",
      projectDir: tmpDir,
      sessionId: "s-disk",
      title: "持久化测试",
    });

    const filePath = path.join(notebooksDir, "s-disk.json");
    expect(existsSync(filePath)).toBe(true);

    const saved = JSON.parse(readFileSync(filePath, "utf8"));
    expect(saved.entries.length).toBe(1);
    expect(saved.entries[0].title).toBe("持久化测试");

    // 清理
    unlinkSync(filePath);
  });
});
