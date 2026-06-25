/**
 * fsEditTool 单元测试
 *
 * 测试范围:
 *   - 精确替换（单处/全部）
 *   - 指定 occurrence 替换
 *   - 行 hash 锚点验证
 *   - 文件不存在错误
 *   - 生成 diff 输出
 *
 * 策略: 使用临时文件进行真实文件 I/O，mock logger。
 *       rollback 不 mock（mock.module 跨文件泄漏会导致 rollback 专用测试失败），
 *       recordFileMutation 在临时目录中安全运行，结果会被 afterEach 清理。
 */
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { createGlobalTmpTestDir } from "../../../helpers/testPaths";

mock.module("@/core/logging/logger", () => ({
  createLogger: () => ({ debug: () => {}, error: () => {}, info: () => {}, warn: () => {} }),
}));
import { fsEditTool } from "@/tool/filesystem/edit";

describe("fsEditTool", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createGlobalTmpTestDir("crab-fs-edit-");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { force: true, recursive: true });
  });

  it("应精确替换第一处匹配", async () => {
    const filePath = path.join(tmpDir, "edit.txt");
    fs.writeFileSync(filePath, "hello world\nhello world\nhello world", "utf8");

    const r = (await fsEditTool.execute({
      path: filePath,
      oldText: "hello world",
      newText: "hi there",
    })) as Record<string, unknown>;

    expect(r.success).toBe(true);
    expect(r.replacements).toBe(1);
    const content = fs.readFileSync(filePath, "utf8");
    const matches = content.split("hello world").length - 1;
    expect(matches).toBe(2); // 替换了 1 处，剩余 2 处
    expect(content).toContain("hi there");
  });

  it("replaceAll=true 应替换所有匹配", async () => {
    const filePath = path.join(tmpDir, "edit.txt");
    fs.writeFileSync(filePath, "aaa\naaa\naaa", "utf8");

    const r = (await fsEditTool.execute({
      path: filePath,
      oldText: "aaa",
      newText: "bbb",
      replaceAll: true,
    })) as Record<string, unknown>;

    expect(r.success).toBe(true);
    expect(r.replacements).toBe(3);
    expect(fs.readFileSync(filePath, "utf8")).toBe("bbb\nbbb\nbbb");
  });

  it("指定 occurrence 应替换第 N 处", async () => {
    const filePath = path.join(tmpDir, "edit.txt");
    fs.writeFileSync(filePath, "foo bar\nfoo bar\nfoo bar\nfoo bar", "utf8");

    const r = (await fsEditTool.execute({
      path: filePath,
      oldText: "foo bar",
      newText: "FOO BAR",
      occurrence: 3,
    })) as Record<string, unknown>;

    expect(r.success).toBe(true);
    expect(r.replacements).toBe(1);
    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split("\n");
    expect(lines[0]).toBe("foo bar");
    expect(lines[1]).toBe("foo bar");
    expect(lines[2]).toBe("FOO BAR");
    expect(lines[3]).toBe("foo bar");
  });

  it("occurrence 超出范围应返回错误", async () => {
    const filePath = path.join(tmpDir, "edit.txt");
    fs.writeFileSync(filePath, "aa\naa", "utf8");

    const r = (await fsEditTool.execute({
      path: filePath,
      oldText: "aa",
      newText: "bb",
      occurrence: 5,
    })) as Record<string, unknown>;

    expect(r.success).toBe(false);
    expect(r.error).toBeDefined();
    expect(r.error as string).toContain("只有 2 处匹配");
  });

  it("文件不存在应返回错误", async () => {
    const r = (await fsEditTool.execute({
      path: "/nonexistent/file.txt",
      oldText: "old",
      newText: "new",
    })) as Record<string, unknown>;

    expect(r.success).toBe(false);
    expect(r.error as string).toContain("不存在");
  });

  it("未找到匹配文本应返回错误", async () => {
    const filePath = path.join(tmpDir, "edit.txt");
    fs.writeFileSync(filePath, "hello world", "utf8");

    const r = (await fsEditTool.execute({
      path: filePath,
      oldText: "not found",
      newText: "replacement",
    })) as Record<string, unknown>;

    expect(r.success).toBe(false);
    expect(r.error).toBeDefined();
  });

  it("成功编辑应返回 diff", async () => {
    const filePath = path.join(tmpDir, "edit.txt");
    fs.writeFileSync(filePath, "line1\nline2\nline3\nline4\nline5", "utf8");

    const r = (await fsEditTool.execute({
      path: filePath,
      oldText: "line3",
      newText: "REPLACED",
    })) as Record<string, unknown>;

    expect(r.success).toBe(true);
    expect(r.diff).toBeDefined();
    expect(r.diff as string).toContain("---");
    expect(r.diff as string).toContain("+++");
    expect(r.diff as string).toContain("-line3");
    expect(r.diff as string).toContain("+REPLACED");
  });

  it("成功编辑应返回行数变化", async () => {
    const filePath = path.join(tmpDir, "edit.txt");
    fs.writeFileSync(filePath, "a\nb\nc", "utf8");

    const r = (await fsEditTool.execute({
      path: filePath,
      oldText: "b",
      newText: "b-extra\nb-extra2",
    })) as Record<string, unknown>;

    expect(r.success).toBe(true);
    expect(r.lineCountBefore).toBe(3);
    expect(r.lineCountAfter).toBe(4);
  });

  it("替换后内容相同应不记录 rollback", async () => {
    const filePath = path.join(tmpDir, "edit.txt");
    fs.writeFileSync(filePath, "hello", "utf8");

    const r = (await fsEditTool.execute({
      path: filePath,
      oldText: "hello",
      newText: "hello",
    })) as Record<string, unknown>;

    expect(r.success).toBe(true);
    // 内容未变化，不应有 rollbackId
    expect(r.rollbackId).toBeUndefined();
  });
});
