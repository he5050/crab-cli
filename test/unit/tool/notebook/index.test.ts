import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

import { notebookTool, getNotesForFile } from "@/tool/notebook";
import { createGlobalTmpTestDir } from "../../../helpers/testPaths";

/**
 * notebook 模块测试
 *
 * 测试策略:
 * - 使用唯一 sessionId 隔离每个测试，避免模块级 Map 污染
 * - 纯内存操作不需要 projectDir；持久化测试使用临时目录
 * - 覆盖全部 8 个 action + getNotesForFile 导出函数 + 错误分支
 */
describe("tool/notebook", () => {
  let tmpDir: string;
  const exec = notebookTool.execute.bind(notebookTool);

  beforeEach(() => {
    tmpDir = createGlobalTmpTestDir("crab-notebook-");
  });

  afterEach(() => {
    rmSync(tmpDir, { force: true, recursive: true });
  });

  // -----------------------------------------------------------------------
  //  1. create — 创建笔记
  // -----------------------------------------------------------------------
  describe("create", () => {
    it("应成功创建笔记并返回完整 entry", async () => {
      const res = await exec({
        action: "create",
        content: "这是笔记内容",
        sessionId: "test-create-1",
        tags: ["tag-a"],
        title: "测试笔记",
      });
      expect(res.success).toBe(true);
      expect(res.action).toBe("create");
      expect(res.entry.title).toBe("测试笔记");
      expect(res.entry.content).toBe("这是笔记内容");
      expect(res.entry.tags).toEqual(["tag-a"]);
      expect(res.entry.id).toMatch(/^note_[a-z0-9]+_[a-z0-9]+$/);
      expect(res.entry.filePaths).toEqual([]);
      expect(res.entry.createdAt).toBeTruthy();
      expect(res.total).toBe(1);
    });

    it("缺少 title 时应返回错误", async () => {
      const res = await exec({
        action: "create",
        content: "无标题",
        sessionId: "test-create-no-title",
      });
      expect(res.success).toBe(false);
      expect(res.error).toContain("title");
    });

    it("不传 content 时默认为空字符串", async () => {
      const res = await exec({
        action: "create",
        sessionId: "test-create-empty-content",
        title: "空内容笔记",
      });
      expect(res.success).toBe(true);
      expect(res.entry.content).toBe("");
    });
  });

  // -----------------------------------------------------------------------
  //  2. read — 读取笔记
  // -----------------------------------------------------------------------
  describe("read", () => {
    it("应能读取已创建的笔记", async () => {
      // 先创建
      const created = await exec({
        action: "create",
        content: "可读内容",
        sessionId: "test-read-1",
        title: "待读取笔记",
      });
      const noteId = (created as any).entry.id;

      // 再读取
      const res = await exec({ action: "read", noteId, sessionId: "test-read-1" });
      expect(res.success).toBe(true);
      expect((res as any).entry.title).toBe("待读取笔记");
    });

    it("读取不存在的 noteId 应返回错误", async () => {
      const res = await exec({ action: "read", noteId: "fake_id", sessionId: "test-read-missing" });
      expect(res.success).toBe(false);
      expect((res as any).error).toContain("不存在");
    });

    it("缺少 noteId 时应返回错误", async () => {
      const res = await exec({ action: "read", sessionId: "test-read-no-id" });
      expect(res.success).toBe(false);
      expect((res as any).error).toContain("noteId");
    });
  });

  // -----------------------------------------------------------------------
  //  3. update — 更新笔记
  // -----------------------------------------------------------------------
  describe("update", () => {
    it("应能更新笔记的标题、内容和标签", async () => {
      const created = await exec({
        action: "create",
        content: "原始内容",
        sessionId: "test-update-1",
        tags: ["old-tag"],
        title: "原始标题",
      });
      const noteId = (created as any).entry.id;

      const res = await exec({
        action: "update",
        content: "更新后内容",
        noteId,
        sessionId: "test-update-1",
        tags: ["new-tag"],
        title: "新标题",
      });
      expect(res.success).toBe(true);
      const entry = (res as any).entry;
      expect(entry.title).toBe("新标题");
      expect(entry.content).toBe("更新后内容");
      expect(entry.tags).toEqual(["new-tag"]);
      expect(entry.updatedAt).toBeTruthy();
    });

    it("更新不存在的 noteId 应返回错误", async () => {
      const res = await exec({
        action: "update",
        content: "无效更新",
        noteId: "nonexistent",
        sessionId: "test-update-missing",
        title: "无效",
      });
      expect(res.success).toBe(false);
      expect((res as any).error).toContain("不存在");
    });
  });

  // -----------------------------------------------------------------------
  //  4. delete — 删除笔记
  // -----------------------------------------------------------------------
  describe("delete", () => {
    it("应能删除笔记并返回被删除的条目", async () => {
      const created = await exec({
        action: "create",
        sessionId: "test-delete-1",
        title: "待删除笔记",
      });
      const noteId = (created as any).entry.id;

      const res = await exec({ action: "delete", noteId, sessionId: "test-delete-1" });
      expect(res.success).toBe(true);
      expect((res as any).entry.id).toBe(noteId);

      // 删除后应无法再读取
      const readRes = await exec({ action: "read", noteId, sessionId: "test-delete-1" });
      expect(readRes.success).toBe(false);
    });

    it("删除不存在的 noteId 应返回错误", async () => {
      const res = await exec({ action: "delete", noteId: "ghost", sessionId: "test-delete-missing" });
      expect(res.success).toBe(false);
      expect((res as any).error).toContain("不存在");
    });
  });

  // -----------------------------------------------------------------------
  //  5. search — 搜索笔记
  // -----------------------------------------------------------------------
  describe("search", () => {
    it("关键词搜索应匹配标题、内容和标签", async () => {
      const sid = "test-search-kw";
      await exec({
        action: "create",
        content: "TypeScript 入门教程",
        sessionId: sid,
        tags: ["教程"],
        title: "TS学习笔记",
      });
      await exec({ action: "create", content: "日常记录", sessionId: sid, tags: ["生活"], title: "日记" });

      const res = await exec({ action: "search", query: "TypeScript", sessionId: sid });
      expect(res.success).toBe(true);
      expect((res as any).total).toBe(1);
      expect((res as any).results[0].title).toBe("TS学习笔记");
    });

    it("按标签搜索应命中对应笔记", async () => {
      const sid = "test-search-tag";
      await exec({ action: "create", content: "内容A", sessionId: sid, tags: ["frontend", "react"], title: "笔记A" });
      await exec({ action: "create", content: "内容B", sessionId: sid, tags: ["backend", "node"], title: "笔记B" });

      const res = await exec({ action: "search", query: "backend", sessionId: sid });
      expect((res as any).total).toBe(1);
      expect((res as any).results[0].title).toBe("笔记B");
    });

    it("正则搜索应正常工作", async () => {
      const sid = "test-search-regex";
      await exec({ action: "create", content: "版本 1.2.3 发布", sessionId: sid, title: "Release" });
      await exec({ action: "create", content: "没有版本号", sessionId: sid, title: "Other" });

      const res = await exec({ action: "search", query: "/\\d+\\.\\d+\\.\\d+/", sessionId: sid });
      expect(res.success).toBe(true);
      expect((res as any).total).toBe(1);
    });

    it("无效正则表达式应返回错误", async () => {
      // (?+abc) 是无效的正则语法，在所有 JS 引擎中都会抛出 SyntaxError
      const res = await exec({ action: "search", query: "/(?+abc)/", sessionId: "test-search-bad-regex" });
      expect(res.success).toBe(false);
      expect((res as any).error).toContain("无效");
    });

    it("缺少 query 时应返回错误", async () => {
      const res = await exec({ action: "search", sessionId: "test-search-no-query" });
      expect(res.success).toBe(false);
      expect((res as any).error).toContain("query");
    });
  });

  // -----------------------------------------------------------------------
  //  6. list — 列出笔记
  // -----------------------------------------------------------------------
  describe("list", () => {
    it("空笔记本应返回空列表", async () => {
      const res = await exec({ action: "list", sessionId: "test-list-empty" });
      expect(res.success).toBe(true);
      expect((res as any).entries).toEqual([]);
      expect((res as any).total).toBe(0);
    });

    it("应返回所有笔记条目", async () => {
      const sid = "test-list-multi";
      await exec({ action: "create", sessionId: sid, title: "第一条" });
      await exec({ action: "create", sessionId: sid, title: "第二条" });
      await exec({ action: "create", sessionId: sid, title: "第三条" });

      const res = await exec({ action: "list", sessionId: sid });
      expect(res.success).toBe(true);
      expect((res as any).total).toBe(3);
      expect((res as any).entries).toHaveLength(3);
    });
  });

  // -----------------------------------------------------------------------
  //  7. associate — 关联笔记与文件
  // -----------------------------------------------------------------------
  describe("associate", () => {
    it("应能将笔记关联到文件路径", async () => {
      const sid = "test-assoc-1";
      const created = await exec({ action: "create", sessionId: sid, title: "关联测试笔记" });
      const noteId = (created as any).entry.id;

      const filePath = join(tmpDir, "src", "app.ts");
      const res = await exec({ action: "associate", filePath, noteId, sessionId: sid, projectDir: tmpDir });
      expect(res.success).toBe(true);
      const normalized = (res as any).entry.filePaths;
      expect(normalized.length).toBeGreaterThanOrEqual(1);
      expect(normalized).toContain(filePath);
    });

    it("重复关联同一路径不应产生重复条目", async () => {
      const sid = "test-assoc-dup";
      const created = await exec({ action: "create", sessionId: sid, title: "去重笔记" });
      const noteId = (created as any).entry.id;
      const filePath = join(tmpDir, "main.ts");

      await exec({ action: "associate", filePath, noteId, sessionId: sid });
      const res = await exec({ action: "associate", filePath, noteId, sessionId: sid });

      // 仍然成功，但 filePaths 中该路径只有一个
      expect(res.success).toBe(true);
      const count = (res as any).entry.filePaths.filter((p: string) => p === filePath).length;
      expect(count).toBe(1);
    });

    it("缺少 noteId 或 filePath 时应返回错误", async () => {
      const r1 = await exec({ action: "associate", filePath: "/tmp/a.ts", sessionId: "test-assoc-no-noteid" });
      expect(r1.success).toBe(false);
      expect((r1 as any).error).toContain("noteId");

      const r2 = await exec({ action: "associate", noteId: "some_id", sessionId: "test-assoc-no-fp" });
      expect(r2.success).toBe(false);
      expect((r2 as any).error).toContain("filePath");
    });
  });

  // -----------------------------------------------------------------------
  //  8. dissociate — 取消关联
  // -----------------------------------------------------------------------
  describe("dissociate", () => {
    it("应能取消笔记与文件的关联", async () => {
      const sid = "test-dissoc-1";
      const created = await exec({ action: "create", sessionId: sid, title: "取消关联笔记" });
      const noteId = (created as any).entry.id;
      const filePath = join(tmpDir, "lib.ts");

      // 先关联
      await exec({ action: "associate", filePath, noteId, sessionId: sid });

      // 再取消关联
      const res = await exec({ action: "dissociate", filePath, noteId, sessionId: sid });
      expect(res.success).toBe(true);
      expect((res as any).entry.filePaths).not.toContain(filePath);
    });

    it("取消不存在的关联应返回错误", async () => {
      const sid = "test-dissoc-no-assoc";
      const created = await exec({ action: "create", sessionId: sid, title: "笔记" });
      const noteId = (created as any).entry.id;

      const res = await exec({ action: "dissociate", filePath: "/no/such/file.ts", noteId, sessionId: sid });
      expect(res.success).toBe(false);
      expect((res as any).error).toContain("未关联");
    });
  });

  // -----------------------------------------------------------------------
  //  9. getNotesForFile — 导出函数
  // -----------------------------------------------------------------------
  describe("getNotesForFile", () => {
    it("应返回与指定文件路径关联的笔记", async () => {
      const sid = "test-getnotes-1";
      const created = await exec({
        action: "create",
        content: "重要笔记内容",
        sessionId: sid,
        tags: ["important"],
        title: "重要笔记",
      });
      const noteId = (created as any).entry.id;
      const filePath = join(tmpDir, "target.ts");

      await exec({ action: "associate", filePath, noteId, sessionId: sid });

      const notes = getNotesForFile(filePath);
      expect(notes.length).toBeGreaterThanOrEqual(1);
      const match = notes.find((n) => n.title === "重要笔记");
      expect(match).toBeDefined();
      expect(match!.content).toBe("重要笔记内容");
      expect(match!.tags).toEqual(["important"]);
    });

    it("无关联笔记时应返回空数组", () => {
      const notes = getNotesForFile("/tmp/no_match_file.ts");
      expect(notes).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  //  10. 持久化 — projectDir 场景
  // -----------------------------------------------------------------------
  describe("持久化存储", () => {
    it("创建笔记时应有持久化文件（传入 projectDir）", async () => {
      const sid = "test-persist-1";
      await exec({ action: "create", content: "持久化内容", projectDir: tmpDir, sessionId: sid, title: "持久化笔记" });

      const persistFile = join(tmpDir, ".crab", "notebooks", `${sid}.json`);
      expect(existsSync(persistFile)).toBe(true);

      // 读取文件验证内容
      const data = JSON.parse(require("node:fs").readFileSync(persistFile, "utf8"));
      expect(data.entries).toHaveLength(1);
      expect(data.entries[0].title).toBe("持久化笔记");
    });
  });

  // -----------------------------------------------------------------------
  //  11. 会话隔离
  // -----------------------------------------------------------------------
  describe("会话隔离", () => {
    it("不同 sessionId 的笔记应互相隔离", async () => {
      const sid1 = "test-isolation-a";
      const sid2 = "test-isolation-b";

      await exec({ action: "create", content: "A 的笔记", sessionId: sid1, title: "笔记A" });
      await exec({ action: "create", content: "B 的笔记", sessionId: sid2, title: "笔记B" });

      const list1 = await exec({ action: "list", sessionId: sid1 });
      const list2 = await exec({ action: "list", sessionId: sid2 });

      expect((list1 as any).total).toBe(1);
      expect((list2 as any).total).toBe(1);
      expect((list1 as any).entries[0].title).toBe("笔记A");
      expect((list2 as any).entries[0].title).toBe("笔记B");
    });
  });

  // -----------------------------------------------------------------------
  //  12. 未知操作
  // -----------------------------------------------------------------------
  describe("未知操作", () => {
    it("传入未知 action 应返回错误", async () => {
      const res = await exec({ action: "explode" as any, sessionId: "test-unknown" });
      expect(res.success).toBe(false);
      expect((res as any).error).toContain("未知");
    });
  });
});
