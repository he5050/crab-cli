/**
 * 文件变更回滚测试
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  recordFileMutation,
  applyRollbackEntry,
  listRollbackEntries,
  previewRollbackEntry,
  cleanupStaleRollbackEntries,
} from "@/tool/rollback/index";

describe("文件变更回滚", () => {
  let projectDir: string;
  let targetFile: string;

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "crab-rollback-test-"));
    targetFile = path.join(projectDir, "test.txt");
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  it("recordFileMutation 记录变更", () => {
    const entry = recordFileMutation({
      after: "new content",
      before: "old content",
      filePath: targetFile,
      projectDir,
      reason: "test mutation",
    });

    expect(entry.id).toMatch(/^rb_/);
    expect(entry.filePath).toBe("test.txt");
    expect(entry.before).toBe("old content");
    expect(entry.after).toBe("new content");
    expect(entry.beforeHash).toBeDefined();
    expect(entry.afterHash).toBeDefined();
    expect(entry.reason).toBe("test mutation");
    expect(entry.createdAt).toBeDefined();

    // 应写入磁盘
    const rollbackDir = path.join(projectDir, ".crab", "rollback");
    expect(fs.existsSync(rollbackDir)).toBe(true);
    const files = fs.readdirSync(rollbackDir).filter((f) => f.endsWith(".json"));
    expect(files.length).toBe(1);
  });

  it("recordFileMutation 记录文件创建（beforeExists=false）", () => {
    const entry = recordFileMutation({
      after: "file content",
      before: "",
      beforeExists: false,
      filePath: targetFile,
      projectDir,
    });

    expect(entry.beforeExists).toBe(false);
    expect(entry.afterExists).toBe(true);
  });

  it("recordFileMutation 记录文件删除（afterExists=false）", () => {
    const entry = recordFileMutation({
      after: "",
      afterExists: false,
      before: "existing content",
      filePath: targetFile,
      projectDir,
    });

    expect(entry.beforeExists).toBe(true);
    expect(entry.afterExists).toBe(false);
  });

  it("rollbackEntry 回滚文件内容", () => {
    // 先写入 after 内容
    fs.writeFileSync(targetFile, "new content");

    const entry = recordFileMutation({
      after: "new content",
      before: "old content",
      filePath: targetFile,
      projectDir,
    });

    const result = applyRollbackEntry(projectDir, entry.id);
    expect(result.ok).toBe(true);
    expect(result.status).toBe("applied");

    // 验证文件已回滚
    const content = fs.readFileSync(targetFile, "utf8");
    expect(content).toBe("old content");
  });

  it("rollbackEntry 回滚删除文件（beforeExists=false -> 恢复文件）", () => {
    const entry = recordFileMutation({
      after: "current content",
      afterExists: false,
      before: "original content",
      filePath: targetFile,
      projectDir,
    });

    const result = applyRollbackEntry(projectDir, entry.id);
    expect(result.ok).toBe(true);
    expect(result.status).toBe("applied");

    const content = fs.readFileSync(targetFile, "utf8");
    expect(content).toBe("original content");
  });

  it("rollbackEntry 回滚创建文件（beforeExists=false -> 删除文件）", () => {
    fs.writeFileSync(targetFile, "new file");

    const entry = recordFileMutation({
      after: "new file",
      before: "",
      beforeExists: false,
      filePath: targetFile,
      projectDir,
    });

    const result = applyRollbackEntry(projectDir, entry.id);
    expect(result.ok).toBe(true);
    expect(result.status).toBe("applied");

    expect(fs.existsSync(targetFile)).toBe(false);
  });

  it("rollbackEntry 内容冲突时拒绝回滚", () => {
    fs.writeFileSync(targetFile, "new content");

    const entry = recordFileMutation({
      after: "new content",
      before: "old content",
      filePath: targetFile,
      projectDir,
    });

    // 修改文件使其 hash 不匹配
    fs.writeFileSync(targetFile, "modified content");

    const result = applyRollbackEntry(projectDir, entry.id);
    expect(result.ok).toBe(false);
    expect(result.status).toBe("conflict");
  });

  it("rollbackEntry 不存在的 ID 返回 not_found", () => {
    const result = applyRollbackEntry(projectDir, "nonexistent_id");
    expect(result.ok).toBe(false);
    expect(result.status).toBe("not_found");
  });

  it("getMutations (listRollbackEntries) 获取变更历史", () => {
    const file1 = path.join(projectDir, "a.txt");
    const file2 = path.join(projectDir, "b.txt");

    recordFileMutation({ after: "a1", before: "a0", filePath: file1, projectDir });
    recordFileMutation({ after: "b1", before: "b0", filePath: file2, projectDir });

    const entries = listRollbackEntries(projectDir);
    expect(entries.length).toBe(2);
    // 按时间倒序
    expect(entries[0]!.createdAt >= entries[1]!.createdAt).toBe(true);
  });

  it("listRollbackEntries 空项目返回空列表", () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "crab-empty-rollback-"));
    try {
      const entries = listRollbackEntries(emptyDir);
      expect(entries).toEqual([]);
    } finally {
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it("previewRollbackEntry 返回预览信息", () => {
    fs.writeFileSync(targetFile, "new content");

    const entry = recordFileMutation({
      after: "new content",
      before: "old content",
      filePath: targetFile,
      projectDir,
    });

    const preview = previewRollbackEntry(projectDir, entry.id);
    expect(preview).not.toBeNull();
    expect(preview!.id).toBe(entry.id);
    expect(preview!.filePath).toBe("test.txt");
    expect(preview!.status).toBe("clean");
    expect(preview!.diff).toBeDefined();
  });

  it("previewRollbackEntry 文件不存在返回 missing", () => {
    const entry = recordFileMutation({
      after: "some content",
      before: "old",
      filePath: targetFile,
      projectDir,
    });

    const preview = previewRollbackEntry(projectDir, entry.id);
    expect(preview).not.toBeNull();
    expect(preview!.status).toBe("missing");
  });
});

describe("cleanupStaleRollbackEntries", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "crab-rollback-cleanup-"));
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  it("空目录应返回 0", () => {
    const removed = cleanupStaleRollbackEntries(projectDir);
    expect(removed).toBe(0);
  });

  it("无过期条目不应清理", () => {
    recordFileMutation({
      after: "new",
      before: "old",
      filePath: path.join(projectDir, "a.txt"),
      projectDir,
    });

    const removed = cleanupStaleRollbackEntries(projectDir, { maxAgeMs: 999_999_999 });
    expect(removed).toBe(0);
    expect(listRollbackEntries(projectDir).length).toBe(1);
  });

  it("过期条目应被清理", () => {
    recordFileMutation({
      after: "new",
      before: "old",
      filePath: path.join(projectDir, "a.txt"),
      projectDir,
    });

    // 手动将 createdAt 改为很早的日期
    const rollbackDir = path.join(projectDir, ".crab", "rollback");
    const files = fs.readdirSync(rollbackDir).filter((f) => f.endsWith(".json"));
    const filePath = path.join(rollbackDir, files[0]!);
    const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    data.createdAt = new Date(Date.now() - 100_000).toISOString(); // 100秒前
    fs.writeFileSync(filePath, JSON.stringify(data));

    const removed = cleanupStaleRollbackEntries(projectDir, { maxAgeMs: 50_000 }); // TTL=50秒
    expect(removed).toBe(1);
    expect(listRollbackEntries(projectDir).length).toBe(0);
  });

  it("maxCount 应保留最新条目", () => {
    // 创建 3 条
    recordFileMutation({ after: "1", before: "0", filePath: path.join(projectDir, "a.txt"), projectDir });
    recordFileMutation({ after: "2", before: "1", filePath: path.join(projectDir, "b.txt"), projectDir });
    recordFileMutation({ after: "3", before: "2", filePath: path.join(projectDir, "c.txt"), projectDir });

    const removed = cleanupStaleRollbackEntries(projectDir, { maxAgeMs: 999_999_999, maxCount: 1 });
    expect(removed).toBe(2); // 删除最旧的 2 条，保留最新的 1 条
    expect(listRollbackEntries(projectDir).length).toBe(1);
  });
});
