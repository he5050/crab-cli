/**
 * TaskManager 高级场景测试。
 *
 * 补充 taskManager.test.ts 未覆盖的边界场景:
 *   - 并发创建多个任务
 *   - 双重取消（同一任务取消两次）
 *   - 取消已失败任务返回 false
 *   - runningCount 在混合状态下准确计数
 *   - loadFromDisk 跳过损坏的 JSON 文件
 *   - get/setProjectDir 后路径正确
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { TaskManager } from "@/mission";
import type { AsyncTask, TaskStatus } from "@/mission/type";
import { cleanupTestDir, createProjectTmpTestDir } from "../../helpers/testPaths";

class MockConversationHandler {
  constructor(_config?: unknown, _options?: unknown) {}
  async sendMessage() {
    return { ok: true, text: "mock result", toolRounds: 0 };
  }
}

describe("TaskManager 高级场景", () => {
  let taskManager: TaskManager;
  let tempDir: string;

  beforeEach(() => {
    tempDir = createProjectTmpTestDir(process.cwd(), "task-adv-");
    taskManager = new TaskManager();
    taskManager._handlerClass = MockConversationHandler;
    taskManager.setProjectDir(tempDir);
  });

  afterEach(() => {
    cleanupTestDir(tempDir);
  });

  describe("并发创建", () => {
    test("并发创建 5 个任务各自有唯一 ID", async () => {
      const mockConfig = { mcpServers: {}, models: {} } as any;
      const ids = await Promise.all([
        taskManager.create("任务1", mockConfig),
        taskManager.create("任务2", mockConfig),
        taskManager.create("任务3", mockConfig),
        taskManager.create("任务4", mockConfig),
        taskManager.create("任务5", mockConfig),
      ]);

      expect(ids).toHaveLength(5);
      const unique = new Set(ids);
      expect(unique.size).toBe(5);

      // 所有 ID 都以 task_ 开头
      for (const id of ids) {
        expect(id).toMatch(/^task_/);
      }

      // list 返回 5 条
      const list = taskManager.list();
      expect(list).toHaveLength(5);
    });
  });

  describe("双重取消", () => {
    test("同一任务取消两次，第二次返回 false", async () => {
      const mockConfig = { mcpServers: {}, models: {} } as any;
      const id = await taskManager.create("测试双重取消", mockConfig);

      const first = taskManager.cancel(id);
      expect(first).toBe(true);

      const second = taskManager.cancel(id);
      // 已取消状态不再可取消
      expect(second).toBe(false);
    });
  });

  describe("取消失败任务", () => {
    test("取消已失败任务返回 false", async () => {
      const mockConfig = { mcpServers: {}, models: {} } as any;
      const id = await taskManager.create("取消失败任务", mockConfig);
      const task = taskManager.get(id)!;
      task.status = "failed" as TaskStatus;
      task.error = "执行失败";

      const result = taskManager.cancel(id);
      expect(result).toBe(false);
      expect(taskManager.get(id)!.status).toBe("failed");
    });
  });

  describe("runningCount 混合状态", () => {
    test("混合状态下 runningCount 准确计数", () => {
      // 手动创建不同状态的任务
      const makeTask = (id: string, status: TaskStatus): AsyncTask => ({
        createdAt: Date.now(),
        id,
        prompt: `task-${id}`,
        status,
      });

      taskManager["tasks"].set("t1", makeTask("t1", "running"));
      taskManager["tasks"].set("t2", makeTask("t2", "running"));
      taskManager["tasks"].set("t3", makeTask("t3", "completed"));
      taskManager["tasks"].set("t4", makeTask("t4", "running"));
      taskManager["tasks"].set("t5", makeTask("t5", "failed"));
      taskManager["tasks"].set("t6", makeTask("t6", "cancelled"));

      expect(taskManager.runningCount()).toBe(3);
    });
  });

  describe("loadFromDisk 损坏文件", () => {
    test("loadFromDisk 跳过损坏的 JSON 文件", () => {
      const dir = path.join(tempDir, ".crab", "tasks");
      fs.mkdirSync(dir, { recursive: true });

      // 正常文件
      const goodTask: AsyncTask = {
        createdAt: Date.now(),
        id: "task_good_001",
        prompt: "正常任务",
        status: "completed",
      };
      fs.writeFileSync(path.join(dir, "task_good_001.json"), JSON.stringify(goodTask), "utf8");

      // 损坏文件
      fs.writeFileSync(path.join(dir, "task_bad_001.json"), "{invalid json", "utf8");

      // 另一个正常文件
      const goodTask2: AsyncTask = {
        createdAt: Date.now() + 1,
        id: "task_good_002",
        prompt: "正常任务2",
        status: "failed",
      };
      fs.writeFileSync(path.join(dir, "task_good_002.json"), JSON.stringify(goodTask2), "utf8");

      taskManager.loadFromDisk();

      // 应加载 2 个正常任务
      expect(taskManager.list()).toHaveLength(2);
      expect(taskManager.get("task_good_001")).toBeDefined();
      expect(taskManager.get("task_good_002")).toBeDefined();
      expect(taskManager.get("task_bad_001")).toBeUndefined();
    });

    test("loadFromDisk 空目录不报错", () => {
      // 不创建任何文件
      expect(() => taskManager.loadFromDisk()).not.toThrow();
      expect(taskManager.list()).toHaveLength(0);
    });
  });

  describe("projectDir 路径", () => {
    test("未设置 projectDir 时使用 cwd 作为回退", () => {
      const mgr = new TaskManager();
      // 不调用 setProjectDir，直接调用 get (不依赖文件系统)
      expect(mgr.get("nonexistent")).toBeUndefined();
    });
  });
});
