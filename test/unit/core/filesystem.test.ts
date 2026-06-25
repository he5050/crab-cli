/**
 * 文件系统工具测试。
 *
 * 测试用例:
 *   - 文件读取
 *   - 文件写入
 *   - 目录操作
 *   - 文件删除
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import stat from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";

import { fsReadTool } from "@/tool/filesystem/read";
import { fsWriteTool } from "@/tool/filesystem/write";
import { fsEditTool } from "@/tool/filesystem/edit";
import { filesystemMultiEditTool } from "@/tool/filesystem/multiEdit";
import { fsBatchTool } from "@/tool/filesystem/batch";
import { acquireFileLock } from "@/tool/filesystem/fileLock";
import { listRollbackEntries } from "@/tool/rollback";
import { cleanupTestDir, createGlobalTmpTestDir } from "../../helpers/testPaths";

// 临时测试目录
const TMP_DIR = createGlobalTmpTestDir("crab-test-fs-");

beforeEach(() => {
  fs.mkdirSync(TMP_DIR, { recursive: true });
});

afterEach(() => {
  cleanupTestDir(TMP_DIR);
});

// ─── filesystem-read ──────────────────────────────────────────

describe("filesystem-read", () => {
  test("读取文本文件内容", async () => {
    const filePath = path.join(TMP_DIR, "test.txt");
    fs.writeFileSync(filePath, "hello\nworld");

    const result = (await fsReadTool.execute({ path: filePath })) as any;
    expect(result.content).toContain("hello");
    expect(result.content).toContain("world");
    expect(result.totalLines).toBe(2);
  });

  test("读取文件带行号和内容哈希", async () => {
    const filePath = path.join(TMP_DIR, "lines.txt");
    fs.writeFileSync(filePath, "line1\nline2\nline3");

    const result = (await fsReadTool.execute({ path: filePath })) as any;
    // 格式: lineNumber:hash\tcontent
    expect(result.content).toMatch(/1:[0-9a-f]{8}\tline1/);
    expect(result.content).toMatch(/2:[0-9a-f]{8}\tline2/);
    expect(result.content).toMatch(/3:[0-9a-f]{8}\tline3/);
  });

  test("分段读取(offset/limit)", async () => {
    const filePath = path.join(TMP_DIR, "big.txt");
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i}`);
    fs.writeFileSync(filePath, lines.join("\n"));

    const result = (await fsReadTool.execute({ limit: 5, offset: 10, path: filePath })) as any;
    expect(result.startLine).toBe(11);
    expect(result.endLine).toBe(15);
    expect(result.content).toContain("line 10");
    expect(result.content).not.toContain("line 5");
  });

  test("读取不存在的文件返回错误", async () => {
    const result = (await fsReadTool.execute({ path: "/nonexistent/file.txt" })) as any;
    expect(result.error).toBeDefined();
  });

  test("缺少 path 参数返回清晰错误", async () => {
    const result = (await fsReadTool.execute({} as any)) as any;
    expect(result.error).toContain("缺少必填参数 path");
    expect(result.path).toBe("<missing>");
  });

  test("filePath 别名在批量读取中可用", async () => {
    const filePath = path.join(TMP_DIR, "filepath-alias.txt");
    fs.writeFileSync(filePath, "alias");

    // 单文件模式下 filePath 不是有效参数名(仅支持 path)
    // 但在批量模式下 filePath 别名可用
    const result = (await fsReadTool.execute({
      path: [{ filePath, offset: 0, path: filePath }],
    })) as any;
    expect(result.type).toBe("batch");
    expect(result.results[0].content).toContain("alias");
  });

  // ── G5: 多文件批量读取 ────────────────────────────────────────

  test("多文件批量读取(字符串数组)", async () => {
    const f1 = path.join(TMP_DIR, "batch1.txt");
    const f2 = path.join(TMP_DIR, "batch2.txt");
    fs.writeFileSync(f1, "content1");
    fs.writeFileSync(f2, "content2");

    const result = (await fsReadTool.execute({ path: [f1, f2] })) as any;
    expect(result.type).toBe("batch");
    expect(result.totalFiles).toBe(2);
    expect(result.successCount).toBe(2);
    expect(result.results[0].content).toContain("content1");
    expect(result.results[1].content).toContain("content2");
  });

  test("多文件批量读取(对象数组，含 offset/limit)", async () => {
    const f = path.join(TMP_DIR, "batchobj.txt");
    fs.writeFileSync(f, "line0\nline1\nline2\nline3\nline4");

    const result = (await fsReadTool.execute({
      path: [{ limit: 2, offset: 1, path: f }],
    })) as any;
    expect(result.type).toBe("batch");
    expect(result.results[0].startLine).toBe(2);
    expect(result.results[0].endLine).toBe(3);
  });

  test("多文件批量读取对象缺少路径时返回单项错误", async () => {
    const result = (await fsReadTool.execute({
      path: [{ offset: 1 }],
    } as any)) as any;
    expect(result.type).toBe("batch");
    expect(result.failCount).toBe(1);
    // 缺少 path/filePath/file_path 时回退到 "<missing>"，文件不存在导致 ENOENT
    expect(result.results[0].error).toBeDefined();
  });

  test("多文件批量读取部分失败返回混合结果", async () => {
    const f1 = path.join(TMP_DIR, "ok.txt");
    const missing = path.join(TMP_DIR, "missing.txt");
    fs.writeFileSync(f1, "ok");

    const result = (await fsReadTool.execute({
      path: [f1, missing],
    })) as any;
    expect(result.type).toBe("batch");
    expect(result.totalFiles).toBe(2);
    expect(result.successCount).toBe(1);
    expect(result.failCount).toBe(1);
  });

  // ── G15: 行尾规范化 ─────────────────────────────────────────

  test("读取 CRLF 文件时自动规范化行尾", async () => {
    const filePath = path.join(TMP_DIR, "crlf.txt");
    fs.writeFileSync(filePath, "line1\r\nline2\r\nline3");

    const result = (await fsReadTool.execute({ path: filePath })) as any;
    // 内容应规范化为 \n(hashline 格式中不应出现 \r)
    expect(result.content).not.toContain("\r");
    expect(result.content).toContain("line1");
    expect(result.content).toContain("line3");
  });

  // ── G17: Office/PDF 内容解析 ─────────────────────────────────

  test("PDF 文件尝试解析文本内容", async () => {
    const filePath = path.join(TMP_DIR, "test.pdf");
    // 创建一个简单的文本型 PDF
    const pdfContent =
      "%PDF-1.0\n1 0 obj\n<</Type /Catalog /Pages 2 0 R>>\nendobj\n2 0 obj\n<</Type /Pages /Kids [3 0 R] /Count 1>>\nendobj\n3 0 obj\n<</Type /Page /Parent 2 0 R /MediaBox [0 0 612 792]>>\nendobj\nxref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \ntrailer\n<</Size 4 /Root 1 0 R>>\nstartxref\n190\n%%EOF";
    fs.writeFileSync(filePath, pdfContent);

    const result = (await fsReadTool.execute({ path: filePath })) as any;
    expect(result.type).toBe("document");
    expect(result.extension).toBe(".pdf");
    // 即使解析不出内容，也不应报错
  });

  test("Office XML 文件尝试解析", async () => {
    const filePath = path.join(TMP_DIR, "test.docx");
    // 创建一个最小的 ZIP 文件包含 XML 文本
    // 由于创建真正的 docx 较复杂，测试回退到元数据
    fs.writeFileSync(filePath, Buffer.from("PK\x03\x04dummy<w:t>Hello</w:t>more"));

    const result = (await fsReadTool.execute({ path: filePath })) as any;
    expect(result.type).toBe("document");
    expect(result.extension).toBe(".docx");
  });

  // ── Hash-anchored 编辑 ───────────────────────────────────────

  test("hash-anchored 编辑验证通过", async () => {
    const filePath = path.join(TMP_DIR, "anchor.txt");
    fs.writeFileSync(filePath, "line1\nline2\nline3");

    // 先读取获取 hashline
    const readResult = (await fsReadTool.execute({ path: filePath })) as any;
    // 从 hashline 格式 "1:hash\tcontent" 中提取 hash
    const hashMatch1 = readResult.content.match(/1:([0-9a-f]{8})\tline1/);
    const hashMatch2 = readResult.content.match(/2:([0-9a-f]{8})\tline2/);
    expect(hashMatch1).toBeTruthy();
    expect(hashMatch2).toBeTruthy();

    const lineHashes: Record<string, string> = {
      "1": hashMatch1![1]!,
      "2": hashMatch2![1]!,
    };

    const editResult = (await fsEditTool.execute({
      lineHashes,
      newText: "REPLACED",
      oldText: "line2",
      path: filePath,
      startLine: 2,
    })) as any;

    expect(editResult.success).toBe(true);
    expect(fs.readFileSync(filePath, "utf8")).toContain("REPLACED");
  });

  test("hash-anchored 编辑验证失败(文件被修改)", async () => {
    const filePath = path.join(TMP_DIR, "anchor-fail.txt");
    fs.writeFileSync(filePath, "original1\noriginal2\noriginal3");

    // 使用错误的 hash 值
    const editResult = (await fsEditTool.execute({
      lineHashes: { "2": "deadbeef" }, // 错误的 hash
      newText: "REPLACED",
      oldText: "original2",
      path: filePath,
      startLine: 2,
    })) as any;

    expect(editResult.success).toBe(false);
    expect(editResult.error).toContain("已被修改");
  });

  test("列出目录内容", async () => {
    fs.writeFileSync(path.join(TMP_DIR, "a.txt"), "a");
    fs.writeFileSync(path.join(TMP_DIR, "b.txt"), "b");
    fs.mkdirSync(path.join(TMP_DIR, "subdir"));

    const result = (await fsReadTool.execute({ path: TMP_DIR })) as any;
    expect(result.type).toBe("directory");
    expect(result.entries.length).toBe(3);
    expect(result.totalFiles).toBe(2);
    expect(result.totalDirectories).toBe(1);
  });

  test("二进制文件返回元数据", async () => {
    const filePath = path.join(TMP_DIR, "test.zip");
    fs.writeFileSync(filePath, Buffer.from([0x50, 0x4b, 0x03, 0x04]));

    const result = (await fsReadTool.execute({ path: filePath })) as any;
    expect(result.type).toBe("binary");
    expect(result.extension).toBe(".zip");
  });
});

// ─── filesystem-write ──────────────────────────────────────────

describe("filesystem-write", () => {
  test("创建新文件", async () => {
    const filePath = path.join(TMP_DIR, "new.txt");
    const result = (await fsWriteTool.execute({ content: "hello", path: filePath })) as any;

    expect(result.success).toBe(true);
    expect(result.action).toBe("创建");
    expect(fs.readFileSync(filePath, "utf8")).toBe("hello");
  });

  test("覆盖已有文件", async () => {
    const filePath = path.join(TMP_DIR, "existing.txt");
    fs.writeFileSync(filePath, "old content");

    const result = (await fsWriteTool.execute({ content: "new content", path: filePath })) as any;
    expect(result.success).toBe(true);
    expect(result.action).toBe("覆盖");
    expect(fs.readFileSync(filePath, "utf8")).toBe("new content");
  });

  test("覆盖已有文件时记录 rollback ledger", async () => {
    const originalCwd = process.cwd();
    process.chdir(TMP_DIR);
    try {
      const filePath = path.join(TMP_DIR, "rollback-write.txt");
      fs.writeFileSync(filePath, "old content");

      const result = (await fsWriteTool.execute({ content: "new content", path: filePath })) as any;
      const entries = listRollbackEntries(TMP_DIR);

      expect(result.success).toBe(true);
      expect(result.rollbackId).toBeDefined();
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        after: "new content",
        before: "old content",
        filePath: "rollback-write.txt",
        id: result.rollbackId,
      });
    } finally {
      process.chdir(originalCwd);
    }
  });

  test("无 Git 项目启用备用文件快照时提示安装或初始化 Git", async () => {
    const originalCwd = process.cwd();
    const projectDir = fs.mkdtempSync(path.join(tmpdir(), "crab-fs-no-git-notice-"));
    process.chdir(projectDir);
    try {
      const filePath = path.join(projectDir, "no-git-notice.txt");
      fs.writeFileSync(filePath, "old content");

      const result = (await fsWriteTool.execute({ content: "new content", path: "no-git-notice.txt" })) as any;

      expect(result.success).toBe(true);
      expect(result.rollbackId).toBeDefined();
      expect(result.fallbackSnapshotNotice).toContain("Git");
      expect(result.fallbackSnapshotNotice).toContain("git init");
      expect(result.fallbackSnapshotNotice).toContain("备用文件快照");
    } finally {
      process.chdir(originalCwd);
      fs.rmSync(projectDir, { force: true, recursive: true });
    }
  });

  test("Git worktree 中记录文件变更时不提示备用文件快照", async () => {
    const originalCwd = process.cwd();
    const projectDir = fs.mkdtempSync(path.join(tmpdir(), "crab-fs-git-notice-"));
    process.chdir(projectDir);
    try {
      execFileSync("git", ["init"], { cwd: projectDir, stdio: "ignore" });
      const filePath = path.join(projectDir, "git-notice.txt");
      fs.writeFileSync(filePath, "old content");

      const result = (await fsWriteTool.execute({ content: "new content", path: "git-notice.txt" })) as any;

      expect(result.success).toBe(true);
      expect(result.rollbackId).toBeDefined();
      expect(result.fallbackSnapshotNotice).toBeUndefined();
    } finally {
      process.chdir(originalCwd);
      fs.rmSync(projectDir, { force: true, recursive: true });
    }
  });

  test("追加模式写入", async () => {
    const filePath = path.join(TMP_DIR, "append.txt");
    fs.writeFileSync(filePath, "line1\n");

    (await fsWriteTool.execute({ append: true, content: "line2\n", path: filePath })) as any;
    expect(fs.readFileSync(filePath, "utf8")).toBe("line1\nline2\n");
  });

  test("追加已有文件时记录 rollback ledger", async () => {
    const originalCwd = process.cwd();
    process.chdir(TMP_DIR);
    try {
      const filePath = path.join(TMP_DIR, "rollback-append.txt");
      fs.writeFileSync(filePath, "line1\n");

      const result = (await fsWriteTool.execute({ append: true, content: "line2\n", path: filePath })) as any;
      const entries = listRollbackEntries(TMP_DIR);

      expect(result.success).toBe(true);
      expect(result.rollbackId).toBeDefined();
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        after: "line1\nline2\n",
        before: "line1\n",
        filePath: "rollback-append.txt",
        id: result.rollbackId,
      });
    } finally {
      process.chdir(originalCwd);
    }
  });

  test("自动创建父目录", async () => {
    const filePath = path.join(TMP_DIR, "deep", "nested", "file.txt");
    const result = (await fsWriteTool.execute({ content: "nested", path: filePath })) as any;
    expect(result.success).toBe(true);
    expect(fs.readFileSync(filePath, "utf8")).toBe("nested");
  });

  // ── G4: 覆盖前备份 ────────────────────────────────────────────

  test("覆盖已有文件时创建备份", async () => {
    const filePath = path.join(TMP_DIR, "backup-test.txt");
    fs.writeFileSync(filePath, "original content");

    const result = (await fsWriteTool.execute({ content: "new content", path: filePath })) as any;

    expect(result.success).toBe(true);
    expect(result.action).toBe("覆盖");
    expect(result.backupPath).toBeDefined();
    expect(fs.existsSync(result.backupPath)).toBe(true);
    // 备份文件应包含原始内容
    expect(fs.readFileSync(result.backupPath, "utf8")).toBe("original content");
    // 目标文件应包含新内容
    expect(fs.readFileSync(filePath, "utf8")).toBe("new content");

    const backupMode = fs.statSync(result.backupPath).mode & 0o777;
    expect(backupMode).toBe(0o600);
    const backupDirMode = fs.statSync(path.dirname(result.backupPath)).mode & 0o777;
    expect(backupDirMode).toBe(0o700);
  });

  test("创建新文件时不创建备份", async () => {
    const filePath = path.join(TMP_DIR, "no-backup-new.txt");

    const result = (await fsWriteTool.execute({ content: "brand new", path: filePath })) as any;

    expect(result.success).toBe(true);
    expect(result.action).toBe("创建");
    expect(result.backupPath).toBeUndefined();
  });

  // ── G15: 行尾保持(write 侧) ──────────────────────────────────

  test("写入已有 CRLF 文件时保持行尾风格", async () => {
    const filePath = path.join(TMP_DIR, "crlf-write.txt");
    fs.writeFileSync(filePath, "line1\r\nline2\r\n");

    const result = (await fsWriteTool.execute({
      content: "replaced1\nreplaced2\n",
      path: filePath,
    })) as any;

    expect(result.success).toBe(true);
    const written = fs.readFileSync(filePath, "utf8");
    // 行尾应被保持为 CRLF
    expect(written).toContain("\r\n");
    expect(written).not.toMatch(/(?<!\r)\n/); // 不应有裸 LF
  });

  // ── G16: 格式化集成(prettier) ──────────────────────────────────

  test("format 参数为 true 时尝试格式化", async () => {
    const filePath = path.join(TMP_DIR, "fmt.ts");
    // Prettier 大概率未安装，所以主要验证不报错
    const result = (await fsWriteTool.execute({
      content: "const x=1;const y=2;",
      format: true,
      path: filePath,
    })) as any;

    expect(result.success).toBe(true);
    // 文件已创建，无论 prettier 是否可用
    expect(fs.existsSync(filePath)).toBe(true);
  });

  test("format 参数对非代码文件跳过格式化", async () => {
    const filePath = path.join(TMP_DIR, "data.bin");
    const result = (await fsWriteTool.execute({
      content: "binary data here",
      format: true,
      path: filePath,
    })) as any;

    expect(result.success).toBe(true);
    expect(result.formatted).toBeUndefined(); // .bin 不在格式化列表中
  });

  test("追加模式不创建备份", async () => {
    const filePath = path.join(TMP_DIR, "no-backup-append.txt");
    fs.writeFileSync(filePath, "line1\n");

    const result = (await fsWriteTool.execute({ append: true, content: "line2\n", path: filePath })) as any;

    expect(result.success).toBe(true);
    expect(result.action).toBe("追加");
    expect(result.backupPath).toBeUndefined();
  });
});

// ─── filesystem-edit ──────────────────────────────────────────

describe("filesystem-edit", () => {
  test("搜索替换成功", async () => {
    const filePath = path.join(TMP_DIR, "edit.txt");
    fs.writeFileSync(filePath, "hello world");

    const result = (await fsEditTool.execute({
      newText: "crab",
      oldText: "world",
      path: filePath,
    })) as any;

    expect(result.success).toBe(true);
    expect(result.replacements).toBe(1);
    expect(fs.readFileSync(filePath, "utf8")).toBe("hello crab");
    expect(result.diff).toContain("-hello world");
    expect(result.diff).toContain("+hello crab");
  });

  test("搜索替换成功时记录 rollback ledger", async () => {
    const originalCwd = process.cwd();
    process.chdir(TMP_DIR);
    try {
      const filePath = path.join(TMP_DIR, "rollback-edit.txt");
      fs.writeFileSync(filePath, "hello world");

      const result = (await fsEditTool.execute({
        newText: "crab",
        oldText: "world",
        path: filePath,
      })) as any;
      const entries = listRollbackEntries(TMP_DIR);

      expect(result.success).toBe(true);
      expect(result.rollbackId).toBeDefined();
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        after: "hello crab",
        before: "hello world",
        filePath: "rollback-edit.txt",
        id: result.rollbackId,
      });
    } finally {
      process.chdir(originalCwd);
    }
  });

  test("多处替换(replaceAll)", async () => {
    const filePath = path.join(TMP_DIR, "multi.txt");
    fs.writeFileSync(filePath, "aaa bbb aaa");

    const result = (await fsEditTool.execute({
      newText: "ccc",
      oldText: "aaa",
      path: filePath,
      replaceAll: true,
    })) as any;

    expect(result.success).toBe(true);
    expect(result.replacements).toBe(2);
    expect(fs.readFileSync(filePath, "utf8")).toBe("ccc bbb ccc");
  });

  test("未找到匹配返回错误", async () => {
    const filePath = path.join(TMP_DIR, "nomatch.txt");
    fs.writeFileSync(filePath, "hello");

    const result = (await fsEditTool.execute({
      newText: "replacement",
      oldText: "notfound",
      path: filePath,
    })) as any;

    expect(result.success).toBe(false);
    expect(result.error).toContain("未找到");
  });

  test("文件不存在返回错误", async () => {
    const result = (await fsEditTool.execute({
      newText: "b",
      oldText: "a",
      path: "/nonexistent/file.txt",
    })) as any;

    expect(result.success).toBe(false);
  });

  // ── G1: 模糊匹配 ──────────────────────────────────────────────

  test("模糊匹配:空白差异容忍", async () => {
    const filePath = path.join(TMP_DIR, "fuzzy.txt");
    fs.writeFileSync(filePath, "function hello() {\n  return 'world';\n}");

    const result = (await fsEditTool.execute({
      path: filePath,
      // AI 生成的 oldText 有缩进差异(空格 vs 实际缩进)
      oldText: "function hello(){\n  return 'world'\n}",
      newText: "function hello() {\n  return 'crab';\n}",
    })) as any;

    expect(result.success).toBe(true);
    expect(result.fuzzyMatch).toBe(true);
    expect(result.similarity).toBeGreaterThanOrEqual(0.75);
    expect(fs.readFileSync(filePath, "utf8")).toContain("crab");
  });

  test("模糊匹配:相似度不足时仍返回失败", async () => {
    const filePath = path.join(TMP_DIR, "fuzzy-fail.txt");
    fs.writeFileSync(filePath, "const x = 1;\nconst y = 2;");

    const result = (await fsEditTool.execute({
      path: filePath,
      // 完全不相关的内容
      oldText: "import React from 'react';\nexport default App()",
      newText: "replaced",
    })) as any;

    expect(result.success).toBe(false);
    expect(result.error).toContain("模糊匹配");
  });

  test("模糊匹配:精确匹配优先(不触发 fuzzyMatch 标志)", async () => {
    const filePath = path.join(TMP_DIR, "exact-first.txt");
    fs.writeFileSync(filePath, "hello world");

    const result = (await fsEditTool.execute({
      newText: "crab",
      oldText: "world",
      path: filePath,
    })) as any;

    expect(result.success).toBe(true);
    expect(result.fuzzyMatch).toBeUndefined(); // 精确匹配不应有 fuzzyMatch 标志
  });

  test("模糊匹配 + replaceAll", async () => {
    const filePath = path.join(TMP_DIR, "fuzzy-multi.txt");
    fs.writeFileSync(filePath, "foo bar\nfoo baz");

    const result = (await fsEditTool.execute({
      newText: "QUX",
      oldText: "foo  bar", // 多一个空格
      path: filePath,
      replaceAll: true,
    })) as any;

    expect(result.success).toBe(true);
  });

  // ── occurrence 参数 ───────────────────────────────────────────

  test("occurrence 参数指定替换第 2 处", async () => {
    const filePath = path.join(TMP_DIR, "occurrence.txt");
    fs.writeFileSync(filePath, "aaa\nbbb\naaa\nccc\naaa");

    const result = (await fsEditTool.execute({
      newText: "XXX",
      occurrence: 2,
      oldText: "aaa",
      path: filePath,
    })) as any;

    expect(result.success).toBe(true);
    const content = fs.readFileSync(filePath, "utf8");
    expect(content).toBe("aaa\nbbb\nXXX\nccc\naaa");
  });

  test("occurrence 超出范围返回错误", async () => {
    const filePath = path.join(TMP_DIR, "occ-over.txt");
    fs.writeFileSync(filePath, "aaa\nbbb\naaa");

    const result = (await fsEditTool.execute({
      newText: "XXX",
      occurrence: 5,
      oldText: "aaa",
      path: filePath,
    })) as any;

    expect(result.success).toBe(false);
    expect(result.error).toContain("只有");
    expect(result.error).toContain("第 5 处");
  });

  test("occurrence=0 等同于 replaceAll", async () => {
    const filePath = path.join(TMP_DIR, "occ-all.txt");
    fs.writeFileSync(filePath, "aaa bbb aaa ccc aaa");

    const result = (await fsEditTool.execute({
      newText: "XXX",
      occurrence: 0,
      oldText: "aaa",
      path: filePath,
    })) as any;

    expect(result.success).toBe(true);
    const content = fs.readFileSync(filePath, "utf8");
    expect(content).toBe("XXX bbb XXX ccc XXX");
  });

  // ── G15: 行尾保持(edit 侧) ────────────────────────────────────

  test("编辑 CRLF 文件时保持行尾风格", async () => {
    const filePath = path.join(TMP_DIR, "crlf-edit.txt");
    fs.writeFileSync(filePath, "hello\r\nworld\r\n");

    const result = (await fsEditTool.execute({
      newText: "goodbye",
      oldText: "hello",
      path: filePath,
    })) as any;

    expect(result.success).toBe(true);
    const written = fs.readFileSync(filePath, "utf8");
    expect(written).toContain("\r\n");
    expect(written).toContain("goodbye");
  });
});

// ─── filesystem-multi-edit ─────────────────────────────────────

describe("filesystem-multi-edit", () => {
  test("成功修改多个文件时为每个文件记录 rollback ledger", async () => {
    const originalCwd = process.cwd();
    process.chdir(TMP_DIR);
    try {
      const fileA = path.join(TMP_DIR, "multi-a.txt");
      const fileB = path.join(TMP_DIR, "multi-b.txt");
      fs.writeFileSync(fileA, "hello a");
      fs.writeFileSync(fileB, "hello b");

      const result = (await filesystemMultiEditTool.execute({
        edits: [
          { file: fileA, newText: "A", oldText: "a" },
          { file: fileB, newText: "B", oldText: "b" },
        ],
      })) as any;
      const entries = listRollbackEntries(TMP_DIR);

      expect(result.success).toBe(true);
      expect(result.rollbackIds).toHaveLength(2);
      expect(entries).toHaveLength(2);
      expect(entries.map((entry) => entry.filePath).toSorted()).toEqual(["multi-a.txt", "multi-b.txt"]);
      expect(entries.map((entry) => entry.before).toSorted()).toEqual(["hello a", "hello b"]);
      expect(entries.map((entry) => entry.after).toSorted()).toEqual(["hello A", "hello B"]);
    } finally {
      process.chdir(originalCwd);
    }
  });

  test("dryRun 不记录 rollback ledger", async () => {
    const originalCwd = process.cwd();
    process.chdir(TMP_DIR);
    try {
      const filePath = path.join(TMP_DIR, "multi-dry-run.txt");
      fs.writeFileSync(filePath, "hello world");

      const result = (await filesystemMultiEditTool.execute({
        dryRun: true,
        edits: [{ file: filePath, newText: "crab", oldText: "world" }],
      })) as any;

      expect(result.success).toBe(true);
      expect(result.rollbackIds).toBeUndefined();
      expect(listRollbackEntries(TMP_DIR)).toHaveLength(0);
      expect(fs.readFileSync(filePath, "utf8")).toBe("hello world");
    } finally {
      process.chdir(originalCwd);
    }
  });
});

// ─── G10: 文件锁 ──────────────────────────────────────────────

describe("file-lock", () => {
  test("获取和释放文件锁", async () => {
    const release = await acquireFileLock(path.join(TMP_DIR, "lock-test.txt"));
    expect(typeof release).toBe("function");
    release(); // 不应抛错
  });

  test("同一文件串行获取锁", async () => {
    const filePath = path.join(TMP_DIR, "serial-lock.txt");
    const order: number[] = [];

    // 启动两个并发锁请求
    const p1 = acquireFileLock(filePath).then(async (release) => {
      order.push(1);
      // 保持锁一小段时间
      await new Promise((r) => setTimeout(r, 50));
      release();
    });

    const p2 = acquireFileLock(filePath).then((release) => {
      order.push(2);
      release();
    });

    await Promise.all([p1, p2]);

    // 锁 1 应在锁 2 之前获取和释放
    expect(order).toEqual([1, 2]);
  });

  test("不同文件可并行获取锁", async () => {
    const f1 = path.join(TMP_DIR, "lock-a.txt");
    const f2 = path.join(TMP_DIR, "lock-b.txt");
    const order: string[] = [];

    const p1 = acquireFileLock(f1).then((release) => {
      order.push("a");
      release();
    });

    const p2 = acquireFileLock(f2).then((release) => {
      order.push("b");
      release();
    });

    await Promise.all([p1, p2]);

    // 两个都应完成，顺序无关
    expect(order).toContain("a");
    expect(order).toContain("b");
  });
});

// ─── filesystem-batch ──────────────────────────────────────────

describe("filesystem-batch", () => {
  test("批量读写操作", async () => {
    const file1 = path.join(TMP_DIR, "a.txt");
    const file2 = path.join(TMP_DIR, "b.txt");

    // 先写入两个文件
    (await fsBatchTool.execute({
      operations: [
        { content: "content A", path: file1, type: "write" },
        { content: "content B", path: file2, type: "write" },
      ],
    })) as any;

    expect(fs.readFileSync(file1, "utf8")).toBe("content A");
    expect(fs.readFileSync(file2, "utf8")).toBe("content B");

    // 批量读取
    const readResult = (await fsBatchTool.execute({
      operations: [
        { path: file1, type: "read" },
        { path: file2, type: "read" },
      ],
    })) as any;

    expect(readResult.success).toBe(true);
    expect(readResult.totalOperations).toBe(2);
    expect(readResult.results[0].content).toBe("content A");
    expect(readResult.results[1].content).toBe("content B");
  });

  test("批量删除操作", async () => {
    const file1 = path.join(TMP_DIR, "del1.txt");
    fs.writeFileSync(file1, "tmp");

    const result = (await fsBatchTool.execute({
      operations: [{ path: file1, type: "delete" }],
    })) as any;

    expect(result.success).toBe(true);
    expect(fs.existsSync(file1)).toBe(false);
  });

  test("批量创建目录", async () => {
    const dirPath = path.join(TMP_DIR, "new-dir");

    const result = (await fsBatchTool.execute({
      operations: [{ path: dirPath, type: "mkdir" }],
    })) as any;

    expect(result.success).toBe(true);
    expect(fs.existsSync(dirPath)).toBe(true);
  });

  test("部分失败时返回混合结果", async () => {
    const result = (await fsBatchTool.execute({
      operations: [
        { path: "/nonexistent/1.txt", type: "read" },
        { content: "ok", path: path.join(TMP_DIR, "ok.txt"), type: "write" },
      ],
    })) as any;

    expect(result.successCount).toBe(1);
    expect(result.failCount).toBe(1);
    expect(result.success).toBe(false);
  });
});
