/**
 * 截断工具测试。
 *
 * 测试用例:
 *   - 内容截断
 *   - 保留策略
 *   - 格式化
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { getGlobalTmpDir } from "@/config/paths";
import { cleanupTestDir, createGlobalTmpTestDir } from "../../helpers/testPaths";

import {
  type TruncateOptions,
  cleanupTruncationFiles,
  countTruncatedFileLines,
  getTruncateDefaults,
  needsTruncation,
  streamReadTruncatedFile,
  truncateToolOutput,
} from "@/tool/result/truncate";

// 临时测试目录
let TMP_DIR: string;

beforeEach(() => {
  TMP_DIR = createGlobalTmpTestDir("crab-test-truncate-");
  fs.mkdirSync(TMP_DIR, { recursive: true });
});

afterEach(() => {
  cleanupTestDir(TMP_DIR);
});

// ─── truncateToolOutput ──────────────────────────────────────────

describe("truncateToolOutput", () => {
  test("短文本不截断", () => {
    const text = "hello\nworld";
    const result = truncateToolOutput(text);

    expect(result.truncated).toBe(false);
    expect(result.content).toBe(text);
  });

  test("超长行数触发截断", () => {
    const lines = Array.from({ length: 3000 }, (_, i) => `line ${i}`);
    const text = lines.join("\n");
    const result = truncateToolOutput(text, { maxLines: 2000 });

    expect(result.truncated).toBe(true);
    expect(result.content).toContain("truncated");
    expect(result).toHaveProperty("outputPath");
  });

  test("超长字节数触发截断", () => {
    const text = "a".repeat(100 * 1024); // 100KB
    const result = truncateToolOutput(text, { maxBytes: 50 * 1024 });

    expect(result.truncated).toBe(true);
    expect(result.content).toContain("truncated");
  });

  test("head 方向截断保留开头", () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i}`);
    const text = lines.join("\n");
    const result = truncateToolOutput(text, { direction: "head", maxLines: 10 });

    expect(result.truncated).toBe(true);
    expect(result.content).toContain("line 0");
    expect(result.content).toContain("line 9");
    expect(result.content).not.toContain("line 50");
  });

  test("tail 方向截断保留末尾", () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i}`);
    const text = lines.join("\n");
    const result = truncateToolOutput(text, { direction: "tail", maxLines: 10 });

    expect(result.truncated).toBe(true);
    expect(result.content).toContain("line 90");
    expect(result.content).toContain("line 99");
    expect(result.content).not.toContain("line 0");
  });

  test("截断时写入临时文件", () => {
    const text = "test content for file writing";
    const result = truncateToolOutput(text, { maxBytes: 10 });

    expect(result.truncated).toBe(true);
    if (!result.truncated) {
      throw new Error("expected truncated result");
    }
    expect(result.outputPath).toBeDefined();
    expect(result.outputPath).not.toBe("(写入失败)");

    // 验证文件内容
    if (result.outputPath && result.outputPath !== "(写入失败)") {
      const savedContent = fs.readFileSync(result.outputPath, "utf8");
      expect(savedContent).toBe(text);
      // 清理
      try {
        fs.unlinkSync(result.outputPath);
      } catch {}
    }
  });

  test("截断结果包含文件路径提示", () => {
    const text = "a".repeat(10_000);
    const result = truncateToolOutput(text, { maxBytes: 100 });

    expect(result.truncated).toBe(true);
    expect(result.content).toContain("完整输出已保存到");
    expect(result.content).toContain("Read 工具");
  });
});

// ─── needsTruncation ──────────────────────────────────────────

describe("needsTruncation", () => {
  test("短文本不需要截断", () => {
    expect(needsTruncation("hello world")).toBe(false);
  });

  test("超长行数需要截断", () => {
    const text = Array.from({ length: 3000 }, (_, i) => `line ${i}`).join("\n");
    expect(needsTruncation(text, { maxLines: 2000 })).toBe(true);
  });

  test("超长字节数需要截断", () => {
    const text = "a".repeat(100 * 1024);
    expect(needsTruncation(text, { maxBytes: 50 * 1024 })).toBe(true);
  });

  test("刚好在边界内不需要截断", () => {
    const lines = Array.from({ length: 2000 }, (_, i) => `line ${i}`);
    expect(needsTruncation(lines.join("\n"), { maxLines: 2000 })).toBe(false);
  });

  test("自定义限制参数", () => {
    expect(needsTruncation("hello\nworld", { maxLines: 1 })).toBe(true);
    expect(needsTruncation("hello world", { maxBytes: 5 })).toBe(true);
  });
});

// ─── getTruncateDefaults ──────────────────────────────────────────

describe("getTruncateDefaults", () => {
  test("返回默认限制值", () => {
    const defaults = getTruncateDefaults();
    expect(defaults.maxLines).toBe(2000);
    expect(defaults.maxBytes).toBe(50 * 1024);
  });
});

// ─── cleanupTruncationFiles ──────────────────────────────────────────

describe("cleanupTruncationFiles", () => {
  test("清理过期文件", () => {
    // 创建模拟的过期文件
    const TRUNCATION_DIR = path.join(getGlobalTmpDir(), "tool-output");
    fs.mkdirSync(TRUNCATION_DIR, { recursive: true });

    const oldFile = path.join(TRUNCATION_DIR, "tool_old_test.txt");
    fs.writeFileSync(oldFile, "old content");

    // 执行清理(不会报错)
    expect(() => cleanupTruncationFiles()).not.toThrow();
  });
});

// ─── streamReadTruncatedFile ──────────────────────────────────────────

describe("streamReadTruncatedFile", () => {
  test("流式读取文件内容", async () => {
    const filePath = path.join(TMP_DIR, "stream-test.txt");
    const lines = Array.from({ length: 50 }, (_, i) => `line ${i}`);
    fs.writeFileSync(filePath, lines.join("\n"));

    const result = await streamReadTruncatedFile(filePath, { limit: 10, offset: 0 });

    expect(result.linesRead).toBe(10);
    expect(result.content).toContain("line 0");
    expect(result.content).toContain("line 9");
    // 50行文件读取10行后，eof = linesRead < limit → 10 < 10 → false
    // 还有更多内容可读(40行未读)，所以 eof=false
    expect(result.eof).toBe(false);
  });

  test("带 offset 的流式读取", async () => {
    const filePath = path.join(TMP_DIR, "stream-offset.txt");
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i}`);
    fs.writeFileSync(filePath, lines.join("\n"));

    const result = await streamReadTruncatedFile(filePath, { limit: 5, offset: 10 });

    expect(result.linesRead).toBe(5);
    expect(result.content).toContain("line 10");
    expect(result.content).toContain("line 14");
    expect(result.content).not.toContain("line 0");
  });

  test("读取到文件末尾", async () => {
    const filePath = path.join(TMP_DIR, "stream-eof.txt");
    fs.writeFileSync(filePath, "line1\nline2\nline3");

    const result = await streamReadTruncatedFile(filePath, { limit: 10, offset: 0 });

    expect(result.linesRead).toBe(3);
    expect(result.eof).toBe(true);
  });

  test("读取不存在的文件返回空", async () => {
    const result = await streamReadTruncatedFile("/nonexistent/file.txt");

    expect(result.content).toBe("");
    expect(result.linesRead).toBe(0);
    expect(result.eof).toBe(true);
  });

  test("默认 limit 为 100 行", async () => {
    const filePath = path.join(TMP_DIR, "stream-default.txt");
    const lines = Array.from({ length: 150 }, (_, i) => `line ${i}`);
    fs.writeFileSync(filePath, lines.join("\n"));

    const result = await streamReadTruncatedFile(filePath, { offset: 0 });

    expect(result.linesRead).toBe(100);
  });
});

// ─── countTruncatedFileLines ──────────────────────────────────────────

describe("countTruncatedFileLines", () => {
  test("统计文件行数", async () => {
    const filePath = path.join(TMP_DIR, "count-test.txt");
    fs.writeFileSync(filePath, "line1\nline2\nline3\nline4\nline5");

    const count = await countTruncatedFileLines(filePath);
    expect(count).toBe(5);
  });

  test("空文件返回 0", async () => {
    const filePath = path.join(TMP_DIR, "empty.txt");
    fs.writeFileSync(filePath, "");

    const count = await countTruncatedFileLines(filePath);
    expect(count).toBe(0);
  });

  test("单行文件返回 1", async () => {
    const filePath = path.join(TMP_DIR, "single.txt");
    fs.writeFileSync(filePath, "only one line");

    const count = await countTruncatedFileLines(filePath);
    expect(count).toBe(1);
  });

  test("不存在的文件返回 0", async () => {
    const count = await countTruncatedFileLines("/nonexistent/file.txt");
    expect(count).toBe(0);
  });

  test("大文件行数统计", async () => {
    const filePath = path.join(TMP_DIR, "large-file.txt");
    const lines = Array.from({ length: 1000 }, (_, i) => `line ${i}`);
    fs.writeFileSync(filePath, lines.join("\n"));

    const count = await countTruncatedFileLines(filePath);
    expect(count).toBe(1000);
  });
});
