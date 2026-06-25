/**
 * 会话分享测试。
 *
 * 测试用例:
 *   - JSON 格式导出
 *   - Markdown 格式导出
 *   - 默认分享格式
 *   - 分享列表
 *   - 分享清理
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  exportSessionAsHtml,
  exportSessionAsJson,
  exportSessionAsMarkdown,
  exportSessionAsText,
  listShares,
  shareSession,
} from "@/session";
import type { ShareMessage } from "@/session/type";

const MOCK_MESSAGES: ShareMessage[] = [
  { content: "你好", role: "user", timestamp: Date.now() - 1000 },
  { content: "你好！有什么可以帮你的？", role: "assistant", timestamp: Date.now() },
];

describe("会话分享 (share)", () => {
  test("exportSessionAsJson 生成 JSON 文件", async () => {
    const result = await exportSessionAsJson(MOCK_MESSAGES);
    expect(result.format).toBe("json");
    expect(result.id).toMatch(/^share_/);
    expect(result.size).toBeGreaterThan(0);

    const content = await fs.readFile(result.path, "utf8");
    const data = JSON.parse(content);
    expect(data.messages).toHaveLength(2);
    expect(data.messages[0].role).toBe("user");
    expect(data.messages[0].parts[0].content).toBe("你好");

    await fs.unlink(result.path).catch(() => {});
  });

  test("exportSessionAsMarkdown 生成 Markdown 文件", async () => {
    const result = await exportSessionAsMarkdown(MOCK_MESSAGES);
    expect(result.format).toBe("markdown");
    expect(result.id).toMatch(/^share_/);
    expect(result.path).toMatch(/\.md$/);

    const content = await fs.readFile(result.path, "utf8");
    expect(content).toContain("# 会话 ");
    expect(content).toContain("你好");
    expect(content).toContain("## 用户");

    await fs.unlink(result.path).catch(() => {});
  });

  test("shareSession 默认使用 markdown 格式", async () => {
    const result = await shareSession(MOCK_MESSAGES);
    expect(result.format).toBe("markdown");
    await fs.unlink(result.path).catch(() => {});
  });

  test("shareSession 可指定 json 格式", async () => {
    const result = await shareSession(MOCK_MESSAGES, { format: "json" });
    expect(result.format).toBe("json");
    await fs.unlink(result.path).catch(() => {});
  });

  test("exportSessionAsText 生成 TXT 文件", async () => {
    const result = await exportSessionAsText(MOCK_MESSAGES);
    expect(result.format).toBe("txt");
    expect(result.path).toMatch(/\.txt$/);

    const content = await fs.readFile(result.path, "utf8");
    expect(content).toContain("Title: 会话 ");
    expect(content).toContain("## 用户");
    expect(content).toContain("你好");

    await fs.unlink(result.path).catch(() => {});
  });

  test("exportSessionAsHtml 生成 HTML 文件", async () => {
    const result = await exportSessionAsHtml(MOCK_MESSAGES);
    expect(result.format).toBe("html");
    expect(result.path).toMatch(/\.html$/);

    const content = await fs.readFile(result.path, "utf8");
    expect(content).toContain("<!doctype html>");
    expect(content).toContain('data-role="user"');
    expect(content).toContain("你好");

    await fs.unlink(result.path).catch(() => {});
  });

  test("shareSession 可指定 txt/html/md 格式", async () => {
    const txt = await shareSession(MOCK_MESSAGES, { format: "txt" });
    const html = await shareSession(MOCK_MESSAGES, { format: "html" });
    const md = await shareSession(MOCK_MESSAGES, { format: "md" });

    expect(txt.format).toBe("txt");
    expect(html.format).toBe("html");
    expect(md.format).toBe("markdown");

    await fs.unlink(txt.path).catch(() => {});
    await fs.unlink(html.path).catch(() => {});
    await fs.unlink(md.path).catch(() => {});
  });

  test("listShares 返回分享列表", async () => {
    const r1 = await shareSession(MOCK_MESSAGES, { format: "json" });
    const list = await listShares();
    expect(list.length).toBeGreaterThanOrEqual(1);
    const found = list.find((s) => s.id === r1.id);
    expect(found).toBeDefined();
    expect(found!.format).toBe("json");
    await fs.unlink(r1.path).catch(() => {});
  });
});
