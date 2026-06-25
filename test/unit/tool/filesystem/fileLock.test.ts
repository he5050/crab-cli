/**
 * 文件锁服务测试
 */
import { describe, it, expect } from "bun:test";
import { acquireFileLock } from "@/tool/filesystem/fileLock";

describe("文件锁服务", () => {
  describe("acquireFileLock", () => {
    it("获取锁并返回 release 函数", async () => {
      const release = await acquireFileLock("/tmp/test-lock-file");
      expect(typeof release).toBe("function");
      release();
    });

    it("同一文件并发获取锁串行执行", async () => {
      const filePath = "/tmp/test-concurrent-lock";
      const order: number[] = [];

      const task1 = acquireFileLock(filePath).then(async (release) => {
        order.push(1);
        await new Promise((r) => setTimeout(r, 50));
        order.push(2);
        release();
      });

      const task2 = acquireFileLock(filePath).then(async (release) => {
        order.push(3);
        await new Promise((r) => setTimeout(r, 50));
        order.push(4);
        release();
      });

      await Promise.all([task1, task2]);

      // task2 必须在 task1 之后
      expect(order).toEqual([1, 2, 3, 4]);
    });

    it("释放后其他等待者可以获取锁", async () => {
      const filePath = "/tmp/test-release-lock";
      let task2Started = false;

      const task1 = acquireFileLock(filePath).then((release) => {
        // 释放锁
        release();
      });

      const task2 = acquireFileLock(filePath).then((release) => {
        task2Started = true;
        release();
      });

      await task1;
      await task2;

      expect(task2Started).toBe(true);
    });

    it("不同文件可以并行获取锁", async () => {
      let aStarted = false;
      let bStarted = false;

      const taskA = acquireFileLock("/tmp/test-lock-a").then(async (release) => {
        aStarted = true;
        await new Promise((r) => setTimeout(r, 50));
        release();
      });

      const taskB = acquireFileLock("/tmp/test-lock-b").then(async (release) => {
        bStarted = true;
        await new Promise((r) => setTimeout(r, 50));
        release();
      });

      await Promise.all([taskA, taskB]);

      expect(aStarted).toBe(true);
      expect(bStarted).toBe(true);
    });

    it("release 函数可多次调用不报错", async () => {
      const release = await acquireFileLock("/tmp/test-double-release");
      release();
      release(); // 第二次调用不应报错
    });
  });
});
