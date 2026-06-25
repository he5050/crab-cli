/**
 * 任务运行时初始化测试。
 *
 * 测试目标:
 *   - 验证 initTaskRuntime 在初始化时正确构建 TaskManager / GoalManager 等组件
 *
 * 测试用例:
 *   - 默认配置下成功初始化
 *   - 异步任务(AsyncTask)类型在初始化后可用
 */
import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { GoalManager, TaskManager, initTaskRuntime } from "@/mission";
import type { AsyncTask } from "@/mission/type";
import { cleanupTestDir, createProjectTmpTestDir } from "../../helpers/testPaths";

describe("initTaskRuntime", () => {
  let tempDir = "";

  afterEach(() => {
    if (tempDir) {
      cleanupTestDir(tempDir);
    }
    tempDir = "";
  });

  test("绑定项目目录并从磁盘恢复任务", () => {
    tempDir = createProjectTmpTestDir(process.cwd(), "task-runtime-init-");
    const taskDir = path.join(tempDir, ".crab", "tasks");
    fs.mkdirSync(taskDir, { recursive: true });

    const persistedTask: AsyncTask = {
      completedAt: Date.now(),
      createdAt: Date.now(),
      id: "task_runtime_restore",
      prompt: "恢复任务",
      result: "done",
      status: "completed",
    };
    fs.writeFileSync(path.join(taskDir, `${persistedTask.id}.json`), JSON.stringify(persistedTask, null, 2), "utf8");

    const taskManager = new TaskManager();
    const goalManager = new GoalManager();

    initTaskRuntime(tempDir, { goalManager, taskManager });

    const loaded = taskManager.get(persistedTask.id);
    expect(loaded).toBeDefined();
    expect(loaded!.prompt).toBe("恢复任务");
    expect(loaded!.status).toBe("completed");
  });

  test("恢复时将 running 任务标记为 failed", () => {
    tempDir = createProjectTmpTestDir(process.cwd(), "task-runtime-running-");
    const taskDir = path.join(tempDir, ".crab", "tasks");
    fs.mkdirSync(taskDir, { recursive: true });

    const persistedTask: AsyncTask = {
      createdAt: Date.now(),
      id: "task_runtime_running",
      prompt: "恢复中的运行任务",
      status: "running",
    };
    fs.writeFileSync(path.join(taskDir, `${persistedTask.id}.json`), JSON.stringify(persistedTask, null, 2), "utf8");

    const taskManager = new TaskManager();
    const goalManager = new GoalManager();

    initTaskRuntime(tempDir, { goalManager, taskManager });

    const loaded = taskManager.get(persistedTask.id);
    expect(loaded).toBeDefined();
    expect(loaded!.status).toBe("failed");
    expect(loaded!.error).toBe("进程重启，任务中断");
  });

  test("恢复时保留仍在存活进程上的 running 任务", () => {
    tempDir = createProjectTmpTestDir(process.cwd(), "task-runtime-alive-");
    const taskDir = path.join(tempDir, ".crab", "tasks");
    fs.mkdirSync(taskDir, { recursive: true });

    const persistedTask: AsyncTask = {
      createdAt: Date.now(),
      id: "task_runtime_running_alive",
      pid: process.pid,
      prompt: "仍在运行的后台任务",
      status: "running",
      updatedAt: Date.now(),
    };
    fs.writeFileSync(path.join(taskDir, `${persistedTask.id}.json`), JSON.stringify(persistedTask, null, 2), "utf8");

    const taskManager = new TaskManager();
    const goalManager = new GoalManager();

    initTaskRuntime(tempDir, { goalManager, taskManager });

    const loaded = taskManager.get(persistedTask.id);
    expect(loaded).toBeDefined();
    expect(loaded!.status).toBe("running");
    expect(loaded!.error).toBeUndefined();
    expect(loaded!.pid).toBe(process.pid);
  });
});
