/**
 * fsBatchTool 单元测试
 *
 * 测试范围:
 *   - 批量操作：read/write/delete/mkdir
 *   - 路径验证（目录外拒绝）
 *   - 操作混合（部分成功部分失败）
 *   - 空操作列表
 *
 * 策略: 使用临时目录进行真实文件 I/O，mock logger。
 */
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { createGlobalTmpTestDir } from "../../../helpers/testPaths";

mock.module("@/core/logging/logger", () => ({
  createLogger: () => ({ debug: () => {}, error: () => {}, info: () => {}, warn: () => {} }),
}));

import { fsBatchTool } from "@/tool/filesystem/batch";

describe("fsBatchTool", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createGlobalTmpTestDir("crab-fs-batch-");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { force: true, recursive: true });
  });

  it("空操作列表应返回成功", async () => {
    const r = (await fsBatchTool.execute({ operations: [] })) as Record<string, unknown>;
    expect(r.success).toBe(true);
    expect(r.totalOperations).toBe(0);
    expect(r.results).toEqual([]);
  });

  it("批量读取多个文件", async () => {
    fs.mkdirSync(path.join(tmpDir, "d1"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "d1", "a.txt"), "Alpha", "utf8");
    fs.writeFileSync(path.join(tmpDir, "d1", "b.txt"), "Beta", "utf8");

    const r = (await fsBatchTool.execute({
      operations: [
        { type: "read", path: path.join(tmpDir, "d1", "a.txt") },
        { type: "read", path: path.join(tmpDir, "d1", "b.txt") },
      ],
    })) as Record<string, unknown>;

    expect(r.success).toBe(true);
    expect(r.totalOperations).toBe(2);
    expect((r.results as Array<Record<string, unknown>>).length).toBe(2);
    expect((r.results as Array<Record<string, unknown>>)[0]!.content).toBe("Alpha");
    expect((r.results as Array<Record<string, unknown>>)[1]!.content).toBe("Beta");
  });

  it("批量创建目录和文件", async () => {
    const r = (await fsBatchTool.execute({
      operations: [
        { type: "mkdir", path: path.join(tmpDir, "newdir") },
        { type: "write", path: path.join(tmpDir, "newdir", "f.txt"), content: "new" },
      ],
    })) as Record<string, unknown>;

    expect(r.success).toBe(true);
    expect(r.totalOperations).toBe(2);
    expect(fs.existsSync(path.join(tmpDir, "newdir", "f.txt"))).toBe(true);
    expect(fs.readFileSync(path.join(tmpDir, "newdir", "f.txt"), "utf8")).toBe("new");
  });

  it("批量删除文件", async () => {
    fs.writeFileSync(path.join(tmpDir, "del.txt"), "bye", "utf8");
    const r = (await fsBatchTool.execute({
      operations: [{ type: "delete", path: path.join(tmpDir, "del.txt") }],
    })) as Record<string, unknown>;

    expect(r.success).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "del.txt"))).toBe(false);
  });

  it("删除不存在的文件应返回失败", async () => {
    const r = (await fsBatchTool.execute({
      operations: [{ type: "delete", path: path.join(tmpDir, "nope.txt") }],
    })) as Record<string, unknown>;

    expect(r.success).toBe(false);
    expect(r.failCount).toBe(1);
  });

  it("部分成功应返回 success=false", async () => {
    fs.writeFileSync(path.join(tmpDir, "ok.txt"), "ok", "utf8");
    const r = (await fsBatchTool.execute({
      operations: [
        { type: "read", path: path.join(tmpDir, "ok.txt") },
        { type: "read", path: path.join(tmpDir, "missing.txt") },
      ],
    })) as Record<string, unknown>;

    expect(r.success).toBe(false);
    expect(r.successCount).toBe(1);
    expect(r.failCount).toBe(1);
  });

  it("path 安全验证拒绝目录外路径", async () => {
    const r = (await fsBatchTool.execute({
      operations: [{ type: "read", path: "/etc/passwd" }],
    })) as Record<string, unknown>;

    expect(r.success).toBe(false);
    expect(r.failCount).toBe(1);
  });
});
