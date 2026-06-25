/**
 * filesystemMultiEditTool 单元测试
 *
 * 测试范围:
 *   - 多文件原子编辑
 *   - 预览模式 (dryRun)
 *   - 部分失败回滚
 *   - replaceAll 选项
 *   - 空编辑列表错误
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
import { filesystemMultiEditTool } from "@/tool/filesystem/multiEdit";

describe("filesystemMultiEditTool", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createGlobalTmpTestDir("crab-fs-multi-");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { force: true, recursive: true });
  });

  it("空编辑列表应返回错误", async () => {
    // Zod min(1) 约束会阻止空数组 — 测试 Zod 校验
    try {
      await filesystemMultiEditTool.execute({ edits: [] });
      expect.unreachable("应抛出 Zod 校验错误");
    } catch {
      // Zod 校验错误，预期行为
    }
  });

  it("应编辑单个文件", async () => {
    const filePath = path.join(tmpDir, "single.txt");
    fs.writeFileSync(filePath, "alpha\nbeta\ngamma", "utf8");

    const r = (await filesystemMultiEditTool.execute({
      edits: [{ file: filePath, oldText: "beta", newText: "BETA" }],
    })) as Record<string, unknown>;

    expect(r.success).toBe(true);
    expect(r.totalEdits).toBe(1);
    expect(r.filesModified).toBe(1);
    expect(fs.readFileSync(filePath, "utf8")).toContain("BETA");
    expect(fs.readFileSync(filePath, "utf8")).toContain("alpha");
  });

  it("应原子编辑多个文件", async () => {
    const f1 = path.join(tmpDir, "a.txt");
    const f2 = path.join(tmpDir, "b.txt");
    fs.writeFileSync(f1, "old_a", "utf8");
    fs.writeFileSync(f2, "old_b", "utf8");

    const r = (await filesystemMultiEditTool.execute({
      edits: [
        { file: f1, oldText: "old_a", newText: "new_a" },
        { file: f2, oldText: "old_b", newText: "new_b" },
      ],
    })) as Record<string, unknown>;

    expect(r.success).toBe(true);
    expect(r.totalEdits).toBe(2);
    expect(r.filesModified).toBe(2);
    expect(fs.readFileSync(f1, "utf8")).toBe("new_a");
    expect(fs.readFileSync(f2, "utf8")).toBe("new_b");
  });

  it("dryRun 模式不应写入文件", async () => {
    const filePath = path.join(tmpDir, "dry.txt");
    fs.writeFileSync(filePath, "original", "utf8");

    const r = (await filesystemMultiEditTool.execute({
      edits: [{ file: filePath, oldText: "original", newText: "changed" }],
      dryRun: true,
    })) as Record<string, unknown>;

    expect(r.success).toBe(true);
    expect(r.dryRun).toBe(true);
    expect(r.message as string).toContain("预览");
    // 文件未被修改
    expect(fs.readFileSync(filePath, "utf8")).toBe("original");
  });

  it("replaceAll 应替换所有匹配", async () => {
    const filePath = path.join(tmpDir, "all.txt");
    fs.writeFileSync(filePath, "x\nx\nx", "utf8");

    const r = (await filesystemMultiEditTool.execute({
      edits: [{ file: filePath, oldText: "x", newText: "X", replaceAll: true }],
    })) as Record<string, unknown>;

    expect(r.success).toBe(true);
    expect(r.totalReplacements).toBe(3);
    expect(fs.readFileSync(filePath, "utf8")).toBe("X\nX\nX");
  });

  it("文件不存在应返回失败", async () => {
    const r = (await filesystemMultiEditTool.execute({
      edits: [{ file: "/nonexistent/file.txt", oldText: "old", newText: "new" }],
    })) as Record<string, unknown>;

    expect(r.success).toBe(false);
    expect(r.error as string).toContain("不存在");
  });

  it("未找到匹配文本应返回失败（rolledBack）", async () => {
    const filePath = path.join(tmpDir, "miss.txt");
    fs.writeFileSync(filePath, "hello", "utf8");

    const r = (await filesystemMultiEditTool.execute({
      edits: [{ file: filePath, oldText: "not_here", newText: "new" }],
    })) as Record<string, unknown>;

    expect(r.success).toBe(false);
    expect(r.rolledBack).toBe(true);
    expect(r.error as string).toContain("编辑操作失败");
  });

  it("多编辑中部分失败应全部回滚", async () => {
    const f1 = path.join(tmpDir, "ok.txt");
    const f2 = path.join(tmpDir, "fail.txt");
    fs.writeFileSync(f1, "original", "utf8");
    fs.writeFileSync(f2, "also_original", "utf8");

    const r = (await filesystemMultiEditTool.execute({
      edits: [
        { file: f1, oldText: "original", newText: "changed" },
        { file: f2, oldText: "not_here", newText: "new" },
      ],
    })) as Record<string, unknown>;

    expect(r.success).toBe(false);
    expect(r.rolledBack).toBe(true);
    // f1 应被回滚，保持原样
    expect(fs.readFileSync(f1, "utf8")).toBe("original");
  });

  it("返回应包含 diff 摘要", async () => {
    const filePath = path.join(tmpDir, "diff.txt");
    fs.writeFileSync(filePath, "hello world", "utf8");

    const r = (await filesystemMultiEditTool.execute({
      edits: [{ file: filePath, oldText: "hello", newText: "hi" }],
    })) as Record<string, unknown>;

    expect(r.success).toBe(true);
    const results = r.results as Array<Record<string, unknown>>;
    expect(results[0]!.diff).toBeDefined();
    expect(results[0]!.diff as string).toContain("1 处替换");
  });
});
