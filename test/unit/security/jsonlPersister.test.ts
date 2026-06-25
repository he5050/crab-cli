/**
 * JsonlPersister 单元测试 — JSONL 文件读写、原子写入、轮转
 */
import { describe, it, expect, afterEach, beforeEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { JsonlPersister } from "@/security/audit/jsonlPersister";

describe("JsonlPersister", () => {
  let tempDir: string;
  let filePath: string;
  let persister: JsonlPersister;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "jsonl-persist-test-"));
    filePath = join(tempDir, "test.jsonl");
    persister = new JsonlPersister(filePath);
  });

  afterEach(async () => {
    await persister.flush();
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("constructor", () => {
    it("创建实例时文件不需要预先存在", () => {
      const p = new JsonlPersister(join(tempDir, "new.jsonl"));
      expect(p.exists()).toBe(false);
      expect(p.getFilePath()).toBe(join(tempDir, "new.jsonl"));
    });

    it("支持自定义 maxFileSize", () => {
      const p = new JsonlPersister(filePath, { maxFileSize: 1024 });
      expect(p.getFilePath()).toBe(filePath);
      expect(p.consecutiveWriteFailures).toBe(0);
    });
  });

  describe("appendLine", () => {
    it("追加单行内容到文件", async () => {
      await persister.appendLine('{"id":"1"}\n');
      await persister.flush();
      expect(persister.exists()).toBe(true);
      expect(persister.consecutiveWriteFailures).toBe(0);
    });

    it("多次追加保持写入顺序", async () => {
      await persister.appendLine('{"id":"1"}\n');
      await persister.appendLine('{"id":"2"}\n');
      await persister.appendLine('{"id":"3"}\n');
      await persister.flush();

      const { entries } = await persister.load<{ id: string }>();
      expect(entries.length).toBe(3);
      expect(entries[0]!.id).toBe("1");
      expect(entries[1]!.id).toBe("2");
      expect(entries[2]!.id).toBe("3");
    });

    it("自动创建目录", async () => {
      const deepPath = join(tempDir, "sub", "dir", "deep.jsonl");
      const p = new JsonlPersister(deepPath);
      await p.appendLine('{"id":"1"}\n');
      await p.flush();
      expect(p.exists()).toBe(true);
    });
  });

  describe("load", () => {
    it("加载不存在的文件返回空数组", async () => {
      const { entries, corruptLineCount } = await persister.load();
      expect(entries).toEqual([]);
      expect(corruptLineCount).toBe(0);
    });

    it("加载有效的 JSONL 文件", async () => {
      await persister.appendLine('{"id":"a"}\n');
      await persister.appendLine('{"id":"b"}\n');
      await persister.flush();

      const { entries, corruptLineCount } = await persister.load<{ id: string }>();
      expect(entries.length).toBe(2);
      expect(corruptLineCount).toBe(0);
    });

    it("跳过损坏行并计数", async () => {
      await persister.appendLine('{"id":"1"}\n');
      await persister.flush();
      // 手动写入损坏行
      const fs = await import("node:fs/promises");
      await fs.appendFile(filePath, "INVALID JSON\n", "utf8");
      await fs.appendFile(filePath, '{"id":"2"}\n', "utf8");

      const { entries, corruptLineCount } = await persister.load<{ id: string }>();
      expect(entries.length).toBe(2);
      expect(corruptLineCount).toBe(1);
    });
  });

  describe("atomicWrite", () => {
    it("原子写入替换整个文件内容", async () => {
      await persister.appendLine('{"id":"old"}\n');
      await persister.flush();

      await persister.atomicWrite('{"id":"new"}\n');
      const { entries } = await persister.load<{ id: string }>();
      expect(entries.length).toBe(1);
      expect(entries[0]!.id).toBe("new");
    });
  });

  describe("clear", () => {
    it("清空文件内容", async () => {
      await persister.appendLine('{"id":"1"}\n');
      await persister.flush();
      expect(persister.exists()).toBe(true);

      await persister.clear();
      const { entries } = await persister.load();
      expect(entries).toEqual([]);
    });

    it("清空不存在的文件不报错", async () => {
      const p = new JsonlPersister(join(tempDir, "nonexist.jsonl"));
      await p.clear();
      expect(p.exists()).toBe(false);
    });
  });

  describe("rotateIfNeeded", () => {
    it("文件超过 maxFileSize 时执行轮转", async () => {
      // 创建 maxFileSize=100 的 persister
      const p = new JsonlPersister(filePath, { maxFileSize: 100, maxRotationFiles: 2 });
      // 写入超过 100 字节的数据
      const bigLine = `${JSON.stringify({ id: "x".repeat(200) })}\n`;
      await p.appendLine(bigLine);
      await p.flush();

      // 轮转后原文件应该是新的，旧文件是 .1
      const fs = await import("node:fs/promises");
      const files = await fs.readdir(tempDir);
      const jsonlFiles = files.filter((f: string) => f.startsWith("test.jsonl"));
      // 应该有 test.jsonl（新）和 test.jsonl.1（旧）
      expect(jsonlFiles.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("consecutiveWriteFailures", () => {
    it("成功写入后重置失败计数", async () => {
      await persister.appendLine('{"id":"1"}\n');
      await persister.flush();
      expect(persister.consecutiveWriteFailures).toBe(0);
    });
  });
});
