/**
 * 文件锁测试。
 *
 * 测试用例:
 *   - 锁获取
 *   - 锁释放
 *   - 并发控制
 */
import { describe, expect, test } from "bun:test";
import path from "node:path";

import { acquireFileLock } from "@/tool/filesystem/fileLock";
import { createGlobalTmpTestDir } from "../../helpers/testPaths";

const TMP_DIR = createGlobalTmpTestDir("crab-test-lock-");

// ─── acquireFileLock ──────────────────────────────────────────

describe("acquireFileLock", () => {
  test("获取和释放文件锁", async () => {
    const filePath = path.join(TMP_DIR, `lock-test-${Date.now()}.txt`);
    const release = await acquireFileLock(filePath);

    expect(typeof release).toBe("function");
    expect(() => release()).not.toThrow();
  });

  test("同一文件串行获取锁", async () => {
    const filePath = path.join(TMP_DIR, `serial-lock-${Date.now()}.txt`);
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
    const f1 = path.join(TMP_DIR, `lock-a-${Date.now()}.txt`);
    const f2 = path.join(TMP_DIR, `lock-b-${Date.now()}.txt`);
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

  test("多锁请求按顺序执行", async () => {
    const filePath = path.join(TMP_DIR, `multi-lock-${Date.now()}.txt`);
    const timestamps: number[] = [];

    const createLockTask = (id: number, delay: number) =>
      acquireFileLock(filePath).then(async (release) => {
        timestamps.push(Date.now());
        await new Promise((r) => setTimeout(r, delay));
        release();
      });

    // 启动三个锁请求
    await Promise.all([createLockTask(1, 30), createLockTask(2, 20), createLockTask(3, 10)]);

    // 验证三个锁都执行了
    expect(timestamps.length).toBe(3);
    // 由于串行执行，时间戳应该是递增的
    expect(timestamps[1]!).toBeGreaterThanOrEqual(timestamps[0]!);
    expect(timestamps[2]!).toBeGreaterThanOrEqual(timestamps[1]!);
  });

  test("锁释放后允许重新获取", async () => {
    const filePath = path.join(TMP_DIR, `relock-${Date.now()}.txt`);

    // 第一次获取锁
    const release1 = await acquireFileLock(filePath);
    release1();

    // 第二次获取锁(应成功)
    const release2 = await acquireFileLock(filePath);
    expect(typeof release2).toBe("function");
    release2();
  });

  test("异常情况下锁最终释放", async () => {
    const filePath = path.join(TMP_DIR, `error-lock-${Date.now()}.txt`);
    const order: string[] = [];

    // 第一个锁在操作中抛出异常
    const p1 = acquireFileLock(filePath)
      .then(async (release) => {
        order.push("a-start");
        try {
          await new Promise((_, reject) => setTimeout(reject, 30));
        } finally {
          release(); // 确保锁被释放
        }
      })
      .catch(() => {
        order.push("a-error");
      });

    // 第二个锁应等待第一个完成后才能获取
    const p2 = acquireFileLock(filePath).then((release) => {
      order.push("b-acquired");
      release();
    });

    await Promise.all([p1, p2]);

    // 即使第一个锁出错，第二个锁也应该能获取到
    expect(order).toContain("b-acquired");
  });
});

// ─── 综合场景 ──────────────────────────────────────────

describe("file-lock 综合场景", () => {
  test("锁在并发写入场景下的保护", async () => {
    const filePath = path.join(TMP_DIR, `concurrent-write-${Date.now()}.txt`);
    const fs = require("node:fs");

    const writeOperations: Promise<void>[] = [];
    const results: string[] = [];

    // 模拟 5 个并发写入操作
    for (let i = 0; i < 5; i++) {
      const op = acquireFileLock(filePath).then(async (release) => {
        // 读取当前内容
        let content = "";
        try {
          content = fs.readFileSync(filePath, "utf8");
        } catch {}

        // 追加写入
        const newContent = `${content}write-${i}\n`;
        fs.writeFileSync(filePath, newContent);
        results.push(`write-${i}`);

        release();
      });
      writeOperations.push(op);
    }

    await Promise.all(writeOperations);

    // 验证所有写入都完成了
    expect(results.length).toBe(5);

    // 验证文件内容(由于串行执行，内容应该是完整的)
    const finalContent = fs.readFileSync(filePath, "utf8");
    for (let i = 0; i < 5; i++) {
      expect(finalContent).toContain(`write-${i}`);
    }

    // 清理
    try {
      fs.unlinkSync(filePath);
    } catch {}
  });
});
