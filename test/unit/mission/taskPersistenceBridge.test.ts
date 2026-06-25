/**
 * 任务持久化桥接测试。
 *
 * 测试目标:
 *   - 验证 TaskManager 与持久化层之间的桥接逻辑(写入/读取/回调)
 *
 * 测试用例:
 *   - 慢响应 handler 期间任务状态被正确持久化
 *   - 多任务并发下持久化互不干扰
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanupTestDir, createGlobalTmpTestDir } from "../../helpers/testPaths";
import { TaskManager } from "@/mission";

class SlowMockConversationHandler {
  constructor(_config?: unknown, _options?: unknown) {}
  async sendMessage() {
    await new Promise((resolve) => setTimeout(resolve, 80));
    return {
      ok: true,
      text: "slow result",
      toolRounds: 0,
    };
  }
}

describe("task persistence bridge", () => {
  let tempDir = "";
  let originalCwd = "";

  beforeEach(() => {
    originalCwd = process.cwd();
    tempDir = createGlobalTmpTestDir("task-persistence-bridge-");
    fs.mkdirSync(path.join(tempDir, ".crab"), { recursive: true });
    process.chdir(tempDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    cleanupTestDir(tempDir);
    tempDir = "";
  });

  test("task-runner 注册的后台任务可被 TaskManager 从同一项目目录恢复", async () => {
    const taskRunner = await import("@/server/taskRunner.ts");
    taskRunner.registerTask("task_bridge_runner_to_manager", "runner -> manager");

    const manager = new TaskManager();
    manager.setProjectDir(tempDir);
    manager.loadFromDisk();

    const task = manager.get("task_bridge_runner_to_manager");
    expect(task).toBeDefined();
    expect(task!.prompt).toBe("runner -> manager");
  });

  test("TaskManager 创建的任务可被 task-runner 在同一项目目录列出", async () => {
    const manager = new TaskManager();
    manager._handlerClass = SlowMockConversationHandler;
    manager.setProjectDir(tempDir);

    const taskId = await manager.create("manager -> runner", { mcpServers: {}, models: {} } as any);

    const taskRunner = await import("@/server/taskRunner.ts");
    const tasks = await taskRunner.listTasks();

    const task = tasks.find((item: { id: string }) => item.id === taskId);
    expect(task).toBeDefined();
    expect(task!.prompt).toBe("manager -> runner");
  });
});
