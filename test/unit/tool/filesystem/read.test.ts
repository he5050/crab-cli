/**
 * fsReadTool 单元测试
 *
 * 测试范围:
 *   - 读取单个文本文件（hashline 格式）
 *   - 读取目录（entries 列表）
 *   - 文件不存在时应返回 error
 *   - offset/limit 分段读取
 *   - 多文件数组参数（batch 模式）
 *
 * 策略: 使用临时文件进行真实文件 I/O，mock logger。
 *
 * 注意: readTextFile 输出带 hashline 前缀 (如 "1:abc\tLine content")，
 *   因此断言应检查内容包含而非精确匹配。
 */
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { createGlobalTmpTestDir } from "../../../helpers/testPaths";

mock.module("@/core/logging/logger", () => ({
  createLogger: () => ({ debug: () => {}, error: () => {}, info: () => {}, warn: () => {} }),
}));

import { fsReadTool } from "@/tool/filesystem/read";

describe("fsReadTool", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createGlobalTmpTestDir("crab-fs-read-");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { force: true, recursive: true });
  });

  it("应读取文本文件内容（hashline 格式）", async () => {
    const filePath = path.join(tmpDir, "readme.md");
    fs.writeFileSync(filePath, "# Title\n\nHello World", "utf8");
    const r = (await fsReadTool.execute({ path: filePath })) as Record<string, unknown>;

    // readTextFile 无 success 字段，无 error 即表示成功
    expect(r.error).toBeUndefined();
    expect(typeof r.content).toBe("string");
    expect(r.content as string).toContain("Hello World");
    expect(r.totalLines).toBe(3);
    expect(r.startLine).toBe(1);
    expect(r.endLine).toBe(3);
  });

  it("文件不存在时应返回 error", async () => {
    const r = (await fsReadTool.execute({ path: "/nonexistent/file.txt" })) as Record<string, unknown>;
    expect(r.error).toBeDefined();
  });

  it("空文件应返回内容（hashline 含空行）", async () => {
    const filePath = path.join(tmpDir, "empty.txt");
    fs.writeFileSync(filePath, "", "utf8");
    const r = (await fsReadTool.execute({ path: filePath })) as Record<string, unknown>;
    expect(r.error).toBeUndefined();
    // 空文件 split("\n") = [""], 生成 "1:hash\t"
    expect(typeof r.content).toBe("string");
    expect((r.content as string).length).toBeGreaterThan(0);
  });

  it("应读取目录并返回 entries 列表", async () => {
    fs.mkdirSync(path.join(tmpDir, "subdir"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "a.txt"), "A");
    fs.writeFileSync(path.join(tmpDir, "b.txt"), "B");

    const r = (await fsReadTool.execute({ path: tmpDir })) as Record<string, unknown>;
    expect(r.error).toBeUndefined();
    expect(r.type).toBe("directory");
    expect(r.totalDirectories).toBe(1);
    expect(r.totalFiles).toBe(2);
    expect(Array.isArray(r.entries)).toBe(true);
    // entries 先 directories 后 files
    const names = (r.entries as Array<{ name: string }>).map((e) => e.name);
    expect(names).toContain("subdir");
    expect(names).toContain("a.txt");
    expect(names).toContain("b.txt");
  });

  it("offset/limit 应分段读取", async () => {
    const lines = Array.from({ length: 10 }, (_, i) => `Line ${i + 1}`);
    fs.writeFileSync(path.join(tmpDir, "big.txt"), lines.join("\n"), "utf8");

    // offset=5 (0-based index), limit=3 → lines[5..8] = Line 6,7,8
    const r = (await fsReadTool.execute({ path: path.join(tmpDir, "big.txt"), offset: 5, limit: 3 })) as Record<
      string,
      unknown
    >;
    expect(r.error).toBeUndefined();
    expect((r.content as string).split("\n").length).toBeLessThanOrEqual(3);
    expect(r.content as string).toContain("Line 6");
    expect(r.content as string).toContain("Line 8");
    expect(r.startLine).toBe(6);
    expect(r.endLine).toBe(8);
  });

  it("limit=0 应返回空内容（0 行限制）", async () => {
    const filePath = path.join(tmpDir, "small.txt");
    fs.writeFileSync(filePath, "abc", "utf8");
    const r = (await fsReadTool.execute({ path: filePath, limit: 0 })) as Record<string, unknown>;
    expect(r.error).toBeUndefined();
    // limit=0 → endLine = startLine+0 = 0, slice(0,0) = []
    expect(r.content).toBe("");
  });

  it("多文件路径数组应返回 batch 模式结果", async () => {
    fs.writeFileSync(path.join(tmpDir, "f1.txt"), "first", "utf8");
    fs.writeFileSync(path.join(tmpDir, "f2.txt"), "second", "utf8");

    const r = (await fsReadTool.execute({
      path: [path.join(tmpDir, "f1.txt"), path.join(tmpDir, "f2.txt")],
    })) as Record<string, unknown>;
    expect(r.error).toBeUndefined();
    expect(r.type).toBe("batch");
    expect(r.totalFiles).toBe(2);
    expect(r.successCount).toBe(2);
    expect(r.failCount).toBe(0);
    const results = r.results as Array<Record<string, unknown>>;
    expect(results.length).toBe(2);
    expect(results[0]!.content as string).toContain("first");
    expect(results[1]!.content as string).toContain("second");
  });
});
