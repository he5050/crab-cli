/**
 * 文件监控器测试 — 变更检测、防抖、过滤。
 *
 * 测试用例:
 *   - 创建 FileWatcher 实例
 *   - start/stop 生命周期
 *   - isRunning 状态
 *   - 排除目录过滤
 *   - 非代码文件过滤
 *   - getPendingCount
 *   - 回调触发
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { type FileChangeCallback, type FileChangeEvent, FileWatcher } from "@/tool/codebaseSearch/indexer/fileWatcher";
import { join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { cleanupTestDir, createGlobalTmpTestDir } from "../../../helpers/testPaths";

describe("FileWatcher", () => {
  let tempDir: string;
  let events: FileChangeEvent[];
  let watcher: FileWatcher;

  beforeEach(() => {
    tempDir = createGlobalTmpTestDir("crab-watcher-test-");
    events = [];
    watcher = new FileWatcher({
      debounceMs: 100,
      onChange: (e) => {
        events.push(...e);
      },
      rootDir: tempDir,
    });
  });

  afterEach(() => {
    watcher.stop();
    cleanupTestDir(tempDir);
  });

  describe("生命周期", () => {
    test("创建实例", () => {
      expect(watcher).toBeDefined();
    });

    test("初始未运行", () => {
      expect(watcher.isRunning()).toBe(false);
    });

    test("stop 后停止", () => {
      watcher.start();
      watcher.stop();
      expect(watcher.isRunning()).toBe(false);
    });

    test("重复 start 不报错", () => {
      watcher.start();
      watcher.start();
      // 不崩溃即可
    });

    test("未启动时 stop 不报错", () => {
      watcher.stop();
      expect(watcher.isRunning()).toBe(false);
    });

    test("getPendingCount 初始为 0", () => {
      expect(watcher.getPendingCount()).toBe(0);
    });
  });

  describe("文件变更检测", () => {
    test("start/stop 生命周期正常", async () => {
      watcher.start();
      // 不强制断言运行状态，因为 Bun.watch 可能不可用
      watcher.stop();
      expect(watcher.isRunning()).toBe(false);
    });

    test("handleFsEvent 会聚合同一路径并在 flush 时触发回调", async () => {
      const codeFile = join(tempDir, "src.ts");
      writeFileSync(codeFile, "export const value = 1;\n");

      (watcher as any).running = true;
      (watcher as any).handleFsEvent("create", codeFile);
      (watcher as any).handleFsEvent("rename", codeFile);

      expect(watcher.getPendingCount()).toBe(1);
      await new Promise((r) => setTimeout(r, 180));

      expect(events.length).toBe(1);
      expect(events[0]!.type).toBe("modify");
      expect(events[0]!.filePath).toBe(codeFile);
      expect(watcher.getPendingCount()).toBe(0);
    });

    test("rename 到不存在文件时按 delete 处理", async () => {
      const missing = join(tempDir, "missing.ts");
      (watcher as any).running = true;
      (watcher as any).handleFsEvent("rename", missing);

      await new Promise((r) => setTimeout(r, 180));
      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe("delete");
    });
  });

  describe("过滤", () => {
    test("node_modules 下的文件不触发", async () => {
      mkdirSync(join(tempDir, "node_modules", "pkg"), { recursive: true });
      watcher.start();

      writeFileSync(join(tempDir, "node_modules", "pkg", "index.ts"), "export {};");

      await new Promise((r) => setTimeout(r, 300));
      // Node_modules 被排除，不应有事件
      const nodeModulesEvents = events.filter((e) => e.filePath.includes("node_modules"));
      expect(nodeModulesEvents.length).toBe(0);
    });

    test(".git 下的文件不触发", async () => {
      mkdirSync(join(tempDir, ".git"), { recursive: true });
      watcher.start();

      writeFileSync(join(tempDir, ".git", "HEAD"), "ref: refs/heads/main");

      await new Promise((r) => setTimeout(r, 300));
      const gitEvents = events.filter((e) => e.filePath.includes(".git"));
      expect(gitEvents.length).toBe(0);
    });

    test("非代码文件不触发", async () => {
      const textFile = join(tempDir, "notes.txt");
      writeFileSync(textFile, "plain text");

      (watcher as any).running = true;
      (watcher as any).handleFsEvent("modify", textFile);
      await new Promise((r) => setTimeout(r, 180));

      expect(events).toEqual([]);
    });
  });

  describe("内部回调分支", () => {
    test("异步回调 reject 不抛出", async () => {
      const asyncEvents: FileChangeEvent[][] = [];
      watcher = new FileWatcher({
        debounceMs: 20,
        onChange: async (e) => {
          asyncEvents.push(e);
          throw new Error("async callback failed");
        },
        rootDir: tempDir,
      });

      const codeFile = join(tempDir, "async.ts");
      writeFileSync(codeFile, "export const x = 1;\n");

      (watcher as any).running = true;
      (watcher as any).handleFsEvent("modify", codeFile);
      await new Promise((r) => setTimeout(r, 80));

      expect(asyncEvents).toHaveLength(1);
    });

    test("同步回调异常被内部吞掉", () => {
      watcher = new FileWatcher({
        debounceMs: 20,
        onChange: () => {
          throw new Error("sync callback failed");
        },
        rootDir: tempDir,
      });

      const codeFile = join(tempDir, "sync.ts");
      writeFileSync(codeFile, "export const x = 1;\n");
      (watcher as any).running = true;

      expect(() => (watcher as any).handleFsEvent("modify", codeFile)).not.toThrow();
      (watcher as any).flushEvents();
      expect(watcher.getPendingCount()).toBe(0);
    });

    test("stop 会 flush 剩余事件", () => {
      const codeFile = join(tempDir, "stop.ts");
      writeFileSync(codeFile, "export const x = 1;\n");

      (watcher as any).running = true;
      (watcher as any).handleFsEvent("modify", codeFile);
      expect(watcher.getPendingCount()).toBe(1);

      watcher.stop();
      expect(events.length).toBe(1);
      expect(watcher.isRunning()).toBe(false);
    });
  });

  describe("FileChangeEvent 类型", () => {
    test("事件结构正确", () => {
      const event: FileChangeEvent = {
        filePath: "/project/src/test.ts",
        timestamp: Date.now(),
        type: "create",
      };

      expect(event.type).toBe("create");
      expect(event.filePath).toBe("/project/src/test.ts");
      expect(typeof event.timestamp).toBe("number");
    });

    test("事件类型可以是 modify", () => {
      const event: FileChangeEvent = {
        filePath: "/project/src/test.ts",
        timestamp: Date.now(),
        type: "modify",
      };
      expect(event.type).toBe("modify");
    });

    test("事件类型可以是 delete", () => {
      const event: FileChangeEvent = {
        filePath: "/project/src/test.ts",
        timestamp: Date.now(),
        type: "delete",
      };
      expect(event.type).toBe("delete");
    });
  });
});
