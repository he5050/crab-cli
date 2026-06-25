/**
 * 任务运行器测试。
 *
 * 测试目标:
 *   - 验证 registerTask/completeTask 端到端流程
 *   - 验证 worker 隔离与失败处理
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { cleanupTestDir, createGlobalTmpTestDir } from "../../helpers/testPaths";

const TASK_RUNNER_MODULE_URL = pathToFileURL(path.join(import.meta.dir, "../../../src/server/taskRunner.ts")).href;

async function runTaskRunnerWorker(options: {
  cwd: string;
  id: string;
  prompt: string;
  result: string;
  sessionId: string;
  startFile: string;
}): Promise<void> {
  const script = `
    const fs = await import("node:fs");
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    while (!fs.existsSync(${JSON.stringify(options.startFile)})) {
      await sleep(1);
    }
    const taskRunner = await import(${JSON.stringify(`${TASK_RUNNER_MODULE_URL}?worker=${options.id}`)});
    taskRunner.registerTask(${JSON.stringify(options.id)}, ${JSON.stringify(options.prompt)});
    taskRunner.completeTask(${JSON.stringify(options.id)}, undefined, {
      result: ${JSON.stringify(options.result)},
      sessionId: ${JSON.stringify(options.sessionId)},
    });
  `;
  const proc = Bun.spawn([process.execPath, "-e", script], {
    cwd: options.cwd,
    env: process.env,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  expect({ exitCode, stderr, stdout }).toMatchObject({ exitCode: 0 });
}

describe("task-runner 跨进程可见性", () => {
  let tempDir = "";
  let originalCwd = "";

  beforeEach(() => {
    originalCwd = process.cwd();
    tempDir = createGlobalTmpTestDir("task-runner-store-");
    fs.mkdirSync(path.join(tempDir, ".crab"), { recursive: true });
    process.chdir(tempDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    cleanupTestDir(tempDir);
    tempDir = "";
  });

  test("registerTask 后其他模块实例仍能读取到任务", async () => {
    const taskRunnerA = await import("@/server/taskRunner.ts");
    taskRunnerA.registerTask("task-cross-process-1", "跨进程任务");

    const taskRunnerB = await import("@/server/taskRunner.ts");
    const tasks = await taskRunnerB.listTasks();

    const found = tasks.find((task: { id: string }) => task.id === "task-cross-process-1");
    expect(found).toBeDefined();
    expect(found?.prompt).toBe("跨进程任务");
    expect(found?.status).toBe("running");
  });

  test("completeTask 会持久化完成状态", async () => {
    const taskRunnerA = await import("@/server/taskRunner.ts");
    taskRunnerA.registerTask("task-cross-process-2", "完成态任务");
    taskRunnerA.completeTask("task-cross-process-2");

    const taskRunnerB = await import("@/server/taskRunner.ts");
    const task = taskRunnerB.getTask("task-cross-process-2");

    expect(task).toBeDefined();
    expect(task?.status).toBe("completed");
    expect(task?.completedAt).toBeDefined();
    expect(task?.updatedAt).toBeDefined();
  });

  test("completeTask 会持久化结果、sessionId 和 tokenUsage", async () => {
    const taskRunnerA = await import("@/server/taskRunner.ts");
    taskRunnerA.registerTask("task-cross-process-meta", "带结果任务");
    taskRunnerA.completeTask("task-cross-process-meta", undefined, {
      result: "最终结果摘要",
      sessionId: "ses_task_meta",
      tokenUsage: { input: 12, output: 34 },
    });

    const taskRunnerB = await import("@/server/taskRunner.ts");
    const task = taskRunnerB.getTask("task-cross-process-meta");

    expect(task).toBeDefined();
    expect(task?.status).toBe("completed");
    expect(task?.result).toBe("最终结果摘要");
    expect(task?.sessionId).toBe("ses_task_meta");
    expect(task?.tokenUsage).toEqual({ input: 12, output: 34 });
  });

  test("交错模块实例写入不会覆盖其他任务记录", async () => {
    const taskRunnerA = await import("@/server/taskRunner.ts");
    taskRunnerA.registerTask("task-interleaved-a", "交错任务 A");

    const taskRunnerB = await import("@/server/taskRunner.ts");
    taskRunnerB.registerTask("task-interleaved-b", "交错任务 B");

    taskRunnerA.completeTask("task-interleaved-a", undefined, {
      result: "A 完成",
      sessionId: "ses_interleaved_a",
    });

    const taskRunnerC = await import("@/server/taskRunner.ts");
    const tasks = await taskRunnerC.listTasks();
    const taskA = tasks.find((task: { id: string }) => task.id === "task-interleaved-a");
    const taskB = tasks.find((task: { id: string }) => task.id === "task-interleaved-b");

    expect(taskA).toBeDefined();
    expect(taskA?.status).toBe("completed");
    expect(taskA?.result).toBe("A 完成");
    expect(taskB).toBeDefined();
    expect(taskB?.status).toBe("running");
    expect(taskB?.prompt).toBe("交错任务 B");
  });

  test("两个真实子进程同时注册并完成任务不会互相覆盖", async () => {
    const startFile = path.join(tempDir, ".crab", "task-runner-start");
    const workerA = runTaskRunnerWorker({
      cwd: tempDir,
      id: "task-concurrent-process-a",
      prompt: "真实子进程任务 A",
      result: "A 完成",
      sessionId: "ses_process_a",
      startFile,
    });
    const workerB = runTaskRunnerWorker({
      cwd: tempDir,
      id: "task-concurrent-process-b",
      prompt: "真实子进程任务 B",
      result: "B 完成",
      sessionId: "ses_process_b",
      startFile,
    });

    fs.writeFileSync(startFile, "start", "utf8");
    await Promise.all([workerA, workerB]);

    const taskRunner = await import("@/server/taskRunner.ts");
    const tasks = await taskRunner.listTasks();
    const taskA = tasks.find((task: { id: string }) => task.id === "task-concurrent-process-a");
    const taskB = tasks.find((task: { id: string }) => task.id === "task-concurrent-process-b");

    expect(taskA).toMatchObject({
      id: "task-concurrent-process-a",
      result: "A 完成",
      sessionId: "ses_process_a",
      status: "completed",
    });
    expect(taskB).toMatchObject({
      id: "task-concurrent-process-b",
      result: "B 完成",
      sessionId: "ses_process_b",
      status: "completed",
    });
  });

  test("任务记录会写入磁盘真值源", async () => {
    const taskRunner = await import("@/server/taskRunner.ts");
    taskRunner.registerTask("task-cross-process-3", "磁盘任务");

    const taskPath = path.join(tempDir, ".crab", "tasks", "task-cross-process-3.json");
    expect(fs.existsSync(taskPath)).toBe(true);

    const content = fs.readFileSync(taskPath, "utf8");
    expect(content).toContain("task-cross-process-3");
    expect(content).toContain("磁盘任务");
  });

  test("running 任务在后台进程已退出时自动转为 failed", async () => {
    const taskRunnerA = await import("@/server/taskRunner.ts");
    taskRunnerA.registerTask("task-cross-process-4", "僵尸任务");
    taskRunnerA.setTaskPid("task-cross-process-4", 999_999);

    const taskRunnerB = await import("@/server/taskRunner.ts");
    const task = taskRunnerB.getTask("task-cross-process-4");

    expect(task).toBeDefined();
    expect(task?.status).toBe("failed");
    expect(task?.error).toBe("后台任务进程已退出");
    expect(task?.completedAt).toBeDefined();
  });

  test("历史清理会裁剪过多的终态任务，但保留运行中任务", async () => {
    const now = Date.now();
    const terminalTasks = Array.from({ length: 205 }, (_, i) => ({
      completedAt: now - i * 1000,
      createdAt: now - i * 1000,
      id: `task-terminal-${i}`,
      prompt: `终态任务 ${i}`,
      status: "completed",
      updatedAt: now - i * 1000,
    }));
    const runningTask = {
      createdAt: now,
      id: "task-running-keep",
      pid: process.pid,
      prompt: "运行中任务",
      status: "running",
      updatedAt: now,
    };

    const taskDir = path.join(tempDir, ".crab", "tasks");
    fs.mkdirSync(taskDir, { recursive: true });
    for (const task of [...terminalTasks, runningTask]) {
      fs.writeFileSync(path.join(taskDir, `${task.id}.json`), JSON.stringify(task, null, 2), "utf8");
    }

    const taskRunner = await import("@/server/taskRunner.ts");
    const tasks = await taskRunner.listTasks();

    expect(tasks.find((task: { id: string }) => task.id === "task-running-keep")).toBeDefined();
    const completed = tasks.filter((task: { status: string }) => task.status === "completed");
    expect(completed.length).toBeLessThanOrEqual(200);
  });

  test("formatTaskRecordLine 包含 pid、更新时间和失败原因摘要", async () => {
    const taskRunner = await import("@/server/taskRunner.ts");
    const line = taskRunner.formatTaskRecordLine({
      createdAt: 1_700_000_000_000,
      error: "测试失败原因",
      id: "task-format-1",
      pid: 4321,
      prompt: "格式化测试任务",
      status: "failed",
      updatedAt: 1_700_000_005_000,
    });

    expect(line).toContain("[failed]");
    expect(line).toContain("task-format-1");
    expect(line).toContain("pid=4321");
    expect(line).toContain("更新:");
    expect(line).toContain("错误: 测试失败原因");
  });

  test("formatTaskRecordDetail 输出单任务可观测详情", async () => {
    const taskRunner = await import("@/server/taskRunner.ts");
    const detail = taskRunner.formatTaskRecordDetail({
      completedAt: 1_700_000_008_000,
      createdAt: 1_700_000_000_000,
      id: "task-detail-1",
      pid: 4321,
      prompt: "详情测试任务",
      result: "任务执行结果",
      sessionId: "ses_task_detail",
      status: "completed",
      tokenUsage: { input: 12, output: 34 },
      updatedAt: 1_700_000_005_000,
    });

    expect(detail).toContain("ID: task-detail-1");
    expect(detail).toContain("状态: completed");
    expect(detail).toContain("提示词: 详情测试任务");
    expect(detail).toContain("PID: 4321");
    expect(detail).toContain("会话: ses_task_detail");
    expect(detail).toContain("Token: input=12, output=34");
    expect(detail).toContain("结果: 任务执行结果");
  });
});
