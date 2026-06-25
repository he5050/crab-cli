/**
 * 批处理工具测试。
 *
 * 测试用例:
 *   - 批量执行
 *   - 结果收集
 *   - 错误处理
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

import { fsBatchTool } from "@/tool/filesystem/batch";
import { cleanupTestDir, createGlobalTmpTestDir } from "../../helpers/testPaths";

// 临时测试目录
const TMP_DIR = createGlobalTmpTestDir("crab-test-batch-");

beforeEach(() => {
  fs.mkdirSync(TMP_DIR, { recursive: true });
});

afterEach(() => {
  cleanupTestDir(TMP_DIR);
});

// ─── 批量写操作 ──────────────────────────────────────────

describe("fsBatchTool - 批量写操作", () => {
  test("批量写入多个文件", async () => {
    const file1 = path.join(TMP_DIR, "batch-write-1.txt");
    const file2 = path.join(TMP_DIR, "batch-write-2.txt");

    const result = (await fsBatchTool.execute({
      operations: [
        { content: "content A", path: file1, type: "write" },
        { content: "content B", path: file2, type: "write" },
      ],
    })) as any;

    expect(result.success).toBe(true);
    expect(result.totalOperations).toBe(2);
    expect(result.successCount).toBe(2);
    expect(result.failCount).toBe(0);

    expect(fs.readFileSync(file1, "utf8")).toBe("content A");
    expect(fs.readFileSync(file2, "utf8")).toBe("content B");
  });

  test("写入时自动创建父目录", async () => {
    const filePath = path.join(TMP_DIR, "deep", "nested", "file.txt");

    const result = (await fsBatchTool.execute({
      operations: [{ content: "nested content", path: filePath, type: "write" }],
    })) as any;

    expect(result.success).toBe(true);
    expect(fs.readFileSync(filePath, "utf8")).toBe("nested content");
  });

  test("批量写入返回行数统计", async () => {
    const filePath = path.join(TMP_DIR, "lines.txt");

    const result = (await fsBatchTool.execute({
      operations: [{ content: "line1\nline2\nline3", path: filePath, type: "write" }],
    })) as any;

    expect(result.results[0].lineCount).toBe(3);
  });
});

// ─── 批量读操作 ──────────────────────────────────────────

describe("fsBatchTool - 批量读操作", () => {
  test("批量读取多个文件", async () => {
    const file1 = path.join(TMP_DIR, "read-1.txt");
    const file2 = path.join(TMP_DIR, "read-2.txt");
    fs.writeFileSync(file1, "content A");
    fs.writeFileSync(file2, "content B");

    const result = (await fsBatchTool.execute({
      operations: [
        { path: file1, type: "read" },
        { path: file2, type: "read" },
      ],
    })) as any;

    expect(result.success).toBe(true);
    expect(result.totalOperations).toBe(2);
    expect(result.results[0].content).toBe("content A");
    expect(result.results[1].content).toBe("content B");
    expect(result.results[0].lineCount).toBe(1);
  });

  test("读取多行文件返回正确行数", async () => {
    const filePath = path.join(TMP_DIR, "multiline.txt");
    fs.writeFileSync(filePath, "line1\nline2\nline3\nline4");

    const result = (await fsBatchTool.execute({
      operations: [{ path: filePath, type: "read" }],
    })) as any;

    expect(result.results[0].success).toBe(true);
    expect(result.results[0].lineCount).toBe(4);
  });

  test("读取不存在的文件返回错误", async () => {
    const missingPath = path.join(TMP_DIR, "missing.txt");
    const result = (await fsBatchTool.execute({
      operations: [{ path: missingPath, type: "read" }],
    })) as any;

    expect(result.success).toBe(false);
    expect(result.successCount).toBe(0);
    expect(result.failCount).toBe(1);
    expect(result.results[0].success).toBe(false);
    expect(result.results[0].error).toContain("不存在");
  });
});

// ─── 批量删除操作 ──────────────────────────────────────────

describe("fsBatchTool - 批量删除操作", () => {
  test("批量删除多个文件", async () => {
    const file1 = path.join(TMP_DIR, "del-1.txt");
    const file2 = path.join(TMP_DIR, "del-2.txt");
    fs.writeFileSync(file1, "tmp1");
    fs.writeFileSync(file2, "tmp2");

    const result = (await fsBatchTool.execute({
      operations: [
        { path: file1, type: "delete" },
        { path: file2, type: "delete" },
      ],
    })) as any;

    expect(result.success).toBe(true);
    expect(result.successCount).toBe(2);
    expect(fs.existsSync(file1)).toBe(false);
    expect(fs.existsSync(file2)).toBe(false);
  });

  test("删除目录(递归)", async () => {
    const dirPath = path.join(TMP_DIR, "to-delete");
    fs.mkdirSync(dirPath, { recursive: true });
    fs.writeFileSync(path.join(dirPath, "file.txt"), "content");

    const result = (await fsBatchTool.execute({
      operations: [{ path: dirPath, type: "delete" }],
    })) as any;

    expect(result.success).toBe(true);
    expect(fs.existsSync(dirPath)).toBe(false);
  });

  test("删除不存在的文件返回错误", async () => {
    const missingPath = path.join(TMP_DIR, "missing-delete.txt");
    const result = (await fsBatchTool.execute({
      operations: [{ path: missingPath, type: "delete" }],
    })) as any;

    expect(result.success).toBe(false);
    expect(result.results[0].success).toBe(false);
    expect(result.results[0].error).toContain("不存在");
  });
});

// ─── 批量创建目录 ──────────────────────────────────────────

describe("fsBatchTool - 批量创建目录", () => {
  test("批量创建多个目录", async () => {
    const dir1 = path.join(TMP_DIR, "new-dir-1");
    const dir2 = path.join(TMP_DIR, "new-dir-2");

    const result = (await fsBatchTool.execute({
      operations: [
        { path: dir1, type: "mkdir" },
        { path: dir2, type: "mkdir" },
      ],
    })) as any;

    expect(result.success).toBe(true);
    expect(result.successCount).toBe(2);
    expect(fs.existsSync(dir1)).toBe(true);
    expect(fs.existsSync(dir2)).toBe(true);
    expect(fs.statSync(dir1).isDirectory()).toBe(true);
    expect(fs.statSync(dir2).isDirectory()).toBe(true);
  });

  test("递归创建嵌套目录", async () => {
    const deepDir = path.join(TMP_DIR, "level1", "level2", "level3");

    const result = (await fsBatchTool.execute({
      operations: [{ path: deepDir, type: "mkdir" }],
    })) as any;

    expect(result.success).toBe(true);
    expect(fs.existsSync(deepDir)).toBe(true);
  });

  test("创建已存在的目录不报错", async () => {
    const dirPath = path.join(TMP_DIR, "existing-dir");
    fs.mkdirSync(dirPath, { recursive: true });

    const result = (await fsBatchTool.execute({
      operations: [{ path: dirPath, type: "mkdir" }],
    })) as any;

    expect(result.success).toBe(true);
  });
});

// ─── 混合操作 ──────────────────────────────────────────

describe("fsBatchTool - 混合操作", () => {
  test("读写删混合操作", async () => {
    const writeFile = path.join(TMP_DIR, "mixed-write.txt");
    const readFile = path.join(TMP_DIR, "mixed-read.txt");
    const deleteFile = path.join(TMP_DIR, "mixed-delete.txt");

    fs.writeFileSync(readFile, "read content");
    fs.writeFileSync(deleteFile, "delete content");

    const result = (await fsBatchTool.execute({
      operations: [
        { content: "written", path: writeFile, type: "write" },
        { path: readFile, type: "read" },
        { path: deleteFile, type: "delete" },
      ],
    })) as any;

    expect(result.success).toBe(true);
    expect(result.totalOperations).toBe(3);
    expect(result.successCount).toBe(3);

    expect(fs.readFileSync(writeFile, "utf8")).toBe("written");
    expect(fs.existsSync(deleteFile)).toBe(false);
  });

  test("部分失败时返回混合结果", async () => {
    const goodFile = path.join(TMP_DIR, "good.txt");
    fs.writeFileSync(goodFile, "ok");

    const result = (await fsBatchTool.execute({
      operations: [
        { path: "/nonexistent/1.txt", type: "read" },
        { path: goodFile, type: "read" },
        { path: "/nonexistent/2.txt", type: "read" },
      ],
    })) as any;

    expect(result.success).toBe(false);
    expect(result.totalOperations).toBe(3);
    expect(result.successCount).toBe(1);
    expect(result.failCount).toBe(2);

    expect(result.results[0].success).toBe(false);
    expect(result.results[1].success).toBe(true);
    expect(result.results[2].success).toBe(false);
  });

  test("空操作列表", async () => {
    const result = (await fsBatchTool.execute({
      operations: [],
    })) as any;

    expect(result.success).toBe(true);
    expect(result.totalOperations).toBe(0);
    expect(result.successCount).toBe(0);
    expect(result.failCount).toBe(0);
  });
});

// ─── 错误处理 ──────────────────────────────────────────

describe("fsBatchTool - 错误处理", () => {
  test("操作类型错误返回失败", async () => {
    const result = (await fsBatchTool.execute({
      operations: [{ path: "/tmp/test.txt", type: "invalid" as any }],
    })) as any;

    // 由于 Zod 校验会在执行前拦截无效类型，这里测试的是执行后的行为
    // 无效操作类型会被跳过，导致成功数为 0
    expect(result.successCount).toBe(0);
  });

  test("写入到无效路径返回错误", async () => {
    const result = (await fsBatchTool.execute({
      operations: [{ content: "test", path: "/invalid/path/that/cannot/exist/file.txt", type: "write" }],
    })) as any;

    expect(result.success).toBe(false);
    expect(result.results[0].success).toBe(false);
  });

  test("错误信息包含具体原因", async () => {
    const result = (await fsBatchTool.execute({
      operations: [{ path: "/definitely/not/exists.txt", type: "read" }],
    })) as any;

    expect(result.results[0].error).toBeDefined();
    expect(typeof result.results[0].error).toBe("string");
  });
});

// ─── 大容量操作 ──────────────────────────────────────────

describe("fsBatchTool - 大容量操作", () => {
  test("大量文件写入", async () => {
    const operations = Array.from({ length: 20 }, (_, i) => ({
      content: `content ${i}`,
      path: path.join(TMP_DIR, `bulk-${i}.txt`),
      type: "write" as const,
    }));

    const result = (await fsBatchTool.execute({ operations })) as any;

    expect(result.success).toBe(true);
    expect(result.totalOperations).toBe(20);
    expect(result.successCount).toBe(20);

    // 验证文件内容
    for (let i = 0; i < 20; i++) {
      const content = fs.readFileSync(path.join(TMP_DIR, `bulk-${i}.txt`), "utf8");
      expect(content).toBe(`content ${i}`);
    }
  });

  test("大量文件读取", async () => {
    // 先创建文件
    for (let i = 0; i < 10; i++) {
      fs.writeFileSync(path.join(TMP_DIR, `read-${i}.txt`), `data ${i}`);
    }

    const operations = Array.from({ length: 10 }, (_, i) => ({
      path: path.join(TMP_DIR, `read-${i}.txt`),
      type: "read" as const,
    }));

    const result = (await fsBatchTool.execute({ operations })) as any;

    expect(result.success).toBe(true);
    expect(result.totalOperations).toBe(10);

    for (let i = 0; i < 10; i++) {
      expect(result.results[i].content).toBe(`data ${i}`);
    }
  });
});
