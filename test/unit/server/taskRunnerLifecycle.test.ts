/**
 * 后台任务运行器测试。
 *
 * 覆盖导出:
 *   - registerTask
 *   - getTask
 *   - listTasks
 *   - completeTask
 *   - setTaskPid
 *   - formatTaskRecordLine
 *
 * 注意:TaskRunner 依赖磁盘文件(~/.crab/task-runner.json)。
 * 测试时使用真实的文件系统操作，但 ID 加前缀避免与真实数据冲突。
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { cleanupTestDir, createGlobalTmpTestDir } from "../../helpers/testPaths";
import type { TaskRecord } from "@/server/taskRunner";

// 使用唯一前缀避免与真实任务冲突
const TEST_PREFIX = `test_${Date.now().toString(36)}_`;

function testId(name: string): string {
  return `${TEST_PREFIX}${name}`;
}

async function loadTaskRunner(caseName: string) {
  return import("@/server/taskRunner.ts");
}

describe("后台任务运行器", () => {
  let tempDir = "";
  let originalCwd = "";

  beforeEach(() => {
    originalCwd = process.cwd();
    tempDir = createGlobalTmpTestDir("task-runner-lifecycle-");
    fs.mkdirSync(path.join(tempDir, ".crab"), { recursive: true });
    process.chdir(tempDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    cleanupTestDir(tempDir);
    tempDir = "";
  });

  describe("registerTask + getTask", () => {
    test("注册任务后可获取", async () => {
      const { registerTask, getTask } = await loadTaskRunner("reg-get");
      const id = testId("reg-get");
      const record = registerTask(id, "测试任务");

      expect(record.id).toBe(id);
      expect(record.prompt).toBe("测试任务");
      expect(record.status).toBe("running");
      expect(record.createdAt).toBeGreaterThan(0);

      const fetched = getTask(id);
      expect(fetched).toBeDefined();
      expect(fetched!.id).toBe(id);
    });

    test("不存在的任务返回 undefined", async () => {
      const { getTask } = await loadTaskRunner("missing");
      expect(getTask(testId("nonexistent"))).toBeUndefined();
    });
  });

  describe("completeTask", () => {
    test("标记任务成功完成", async () => {
      const { registerTask, getTask, completeTask } = await loadTaskRunner("complete-ok");
      const id = testId("complete-ok");
      registerTask(id, "完成测试");

      completeTask(id);

      const task = getTask(id);
      expect(task).toBeDefined();
      expect(task!.status).toBe("completed");
      expect(task!.completedAt).toBeGreaterThan(0);
      expect(task!.error).toBeUndefined();
    });

    test("标记任务失败", async () => {
      const { registerTask, getTask, completeTask } = await loadTaskRunner("complete-fail");
      const id = testId("complete-fail");
      registerTask(id, "失败测试");

      completeTask(id, "执行出错");

      const task = getTask(id);
      expect(task).toBeDefined();
      expect(task!.status).toBe("failed");
      expect(task!.error).toBe("执行出错");
    });
  });

  describe("setTaskPid", () => {
    test("设置 PID 后可查询", async () => {
      const { registerTask, getTask, setTaskPid } = await loadTaskRunner("set-pid");
      const id = testId("set-pid");
      registerTask(id, "PID 测试");

      setTaskPid(id, 12_345);

      const task = getTask(id);
      expect(task).toBeDefined();
      expect(task!.pid).toBe(12_345);
    });

    test("不存在的任务设置 PID 无副作用", async () => {
      const { setTaskPid } = await loadTaskRunner("set-pid-missing");
      expect(() => setTaskPid(testId("no-task-pid"), 999)).not.toThrow();
    });
  });

  describe("listTasks", () => {
    test("返回数组", async () => {
      const { listTasks } = await loadTaskRunner("list-empty");
      const tasks = await listTasks();
      expect(Array.isArray(tasks)).toBe(true);
    });

    test("包含刚注册的测试任务", async () => {
      const { registerTask, listTasks } = await loadTaskRunner("list-find");
      const id = testId("list-find");
      registerTask(id, "列表测试");

      const tasks = await listTasks();
      const found = tasks.find((t: TaskRecord) => t.id === id);
      expect(found).toBeDefined();
      expect(found!.prompt).toBe("列表测试");
    });
  });

  describe("formatTaskRecordLine", () => {
    test("基本格式化", async () => {
      const { formatTaskRecordLine } = await loadTaskRunner("format-basic");
      const task: TaskRecord = {
        createdAt: Date.now(),
        id: "task_001",
        prompt: "测试任务",
        status: "running",
        updatedAt: Date.now(),
      };
      const line = formatTaskRecordLine(task);
      expect(line).toContain("task_001");
      expect(line).toContain("running");
      expect(line).toContain("测试任务");
    });

    test("长 prompt 被截断", async () => {
      const { formatTaskRecordLine } = await loadTaskRunner("format-long");
      const longPrompt = "A".repeat(100);
      const task: TaskRecord = {
        createdAt: Date.now(),
        id: "task_long",
        prompt: longPrompt,
        status: "completed",
      };
      const line = formatTaskRecordLine(task);
      expect(line).toContain("...");
    });

    test("包含 PID 信息", async () => {
      const { formatTaskRecordLine } = await loadTaskRunner("format-pid");
      const task: TaskRecord = {
        createdAt: Date.now(),
        id: "task_pid",
        pid: 12_345,
        prompt: "PID 任务",
        status: "running",
      };
      const line = formatTaskRecordLine(task);
      expect(line).toContain("pid=12345");
    });

    test("失败任务包含错误信息", async () => {
      const { formatTaskRecordLine } = await loadTaskRunner("format-error");
      const task: TaskRecord = {
        createdAt: Date.now(),
        error: "Something went wrong",
        id: "task_err",
        prompt: "错误任务",
        status: "failed",
      };
      const line = formatTaskRecordLine(task);
      expect(line).toContain("错误");
      expect(line).toContain("Something went wrong");
    });

    test("完成任务包含结果摘要与关联会话", async () => {
      const { formatTaskRecordLine } = await loadTaskRunner("format-result");
      const task: TaskRecord = {
        createdAt: Date.now(),
        id: "task_result",
        prompt: "结果任务",
        result: "最终结论:已完成第一阶段修复",
        sessionId: "ses_task_result",
        status: "completed",
      };
      const line = formatTaskRecordLine(task);
      expect(line).toContain("结果");
      expect(line).toContain("最终结论");
      expect(line).toContain("ses_task_result");
    });
  });
});
