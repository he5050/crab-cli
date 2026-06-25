/**
 * logRotation 单元测试 — 轮转触发、备份数、文件创建
 */
import { describe, it, expect, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRotatingLogStream } from "@/server/logRotation";

describe("createRotatingLogStream", () => {
  let tempDir: string;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("创建日志文件并写入内容", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "log-rotation-test-"));
    const logFile = join(tempDir, "test.log");
    const stream = createRotatingLogStream({ logFilePath: logFile, maxBackups: 2, maxSizeBytes: 256 });
    stream.write("hello\n");
    stream.close();

    const fs = await import("node:fs/promises");
    const content = await fs.readFile(logFile, "utf8");
    expect(content).toContain("hello");
  });

  it("超过 maxSize 时触发轮转", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "log-rotation-test-"));
    const logFile = join(tempDir, "rotate.log");
    const fs = await import("node:fs/promises");

    const stream = createRotatingLogStream({ logFilePath: logFile, maxBackups: 2, maxSizeBytes: 32 });
    // 写入超过 32 字节的内容
    for (let i = 0; i < 10; i++) {
      stream.write(`line-${i}-padding-data-here\n`);
    }
    stream.close();

    const files = await fs.readdir(tempDir);
    const logFiles = files.filter((f: string) => f.startsWith("rotate.log"));
    // 应该有 rotate.log（当前）+ rotate.log.1.log（备份）
    expect(logFiles.length).toBeGreaterThanOrEqual(2);
  });

  it("maxBackups=1 时只保留一个备份", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "log-rotation-test-"));
    const logFile = join(tempDir, "backup.log");
    const fs = await import("node:fs/promises");

    const stream = createRotatingLogStream({ logFilePath: logFile, maxBackups: 1, maxSizeBytes: 16 });
    // 多次轮转
    for (let i = 0; i < 20; i++) {
      stream.write(`padding-data-${i}\n`);
    }
    stream.close();

    const files = await fs.readdir(tempDir);
    const backupFiles = files.filter((f: string) => f.startsWith("backup.log") && f !== "backup.log");
    // 只保留 .1.log
    expect(backupFiles.length).toBeLessThanOrEqual(1);
  });

  it("自动创建目录", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "log-rotation-test-"));
    const deepDir = join(tempDir, "sub", "dir");
    const logFile = join(deepDir, "deep.log");
    const stream = createRotatingLogStream({ logFilePath: logFile });
    stream.write("deep\n");
    stream.close();

    const fs = await import("node:fs/promises");
    const content = await fs.readFile(logFile, "utf8");
    expect(content).toBe("deep\n");
  });

  it("close 后不再写入", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "log-rotation-test-"));
    const logFile = join(tempDir, "close.log");
    const stream = createRotatingLogStream({ logFilePath: logFile });
    stream.write("before\n");
    stream.close();
    stream.write("after\n");

    const fs = await import("node:fs/promises");
    const content = await fs.readFile(logFile, "utf8");
    expect(content).toBe("before\n");
  });
});
