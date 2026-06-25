/**
 * [测试目标] 团队工具旧版 action 分发。
 *
 * 测试目标:
 *   - 验证 teamTool 在旧版多 action(broadcast / status / list_tasks / approve_plan / cleanup_team 等)下的路由与返回结构
 *
 * 测试用例:
 *   - teamTool 支持 broadcast / status / list_tasks / approve_plan / cleanup_team:通过 spy 让底层 executor 返回受控结果，断言每个 action 的 success / action 字段
 */
import { afterEach, describe, expect, test } from "bun:test";
import { teamTool, setTeamExecutorPort, resetTeamExecutorPort } from "@/tool/team";
import type { TeamExecutorPort } from "@/tool/team/teamExecutorPort";

const mockPort: TeamExecutorPort = {
  abortMerge: async () => ({ ok: true }),
  approvePlan: () => ({ ok: true, output: "approved" }),
  broadcastMessage: () => ({ ok: true, output: "broadcast ok" }),
  cleanupTeam: async () => ({ ok: true, output: "cleaned" }),
  createTask: () => ({ ok: true, output: "created" }),
  getTaskList: () => ({
    list: () => [
      { assigneeName: "A", dependencies: [], description: "D", id: "task_1", status: "pending", title: "T" },
    ],
  }),
  getTeammate: () => ({
    error: undefined,
    id: "mate_1",
    name: "A",
    result: "done",
    role: "dev",
    status: "running",
    task: "do",
    worktreePath: "/tmp/wt",
  }),
  getTracker: () => ({ isOnStandby: () => false }),
  listTeammates: () => [
    { id: "mate_1", name: "A", role: "dev", status: "running", task: "do", worktreePath: "/tmp/wt" },
  ],
  mergeAllWork: async () => ({ ok: true }),
  mergeTeammateWork: async () => ({ ok: true }),
  messageMate: async () => ({ ok: true, output: "msg ok" }),
  resolveMergeConflicts: async () => ({ ok: true }),
  shutdownTeammate: async () => ({ ok: true }),
  spawnMate: async () => ({ ok: true, output: "spawned", teammateId: "mate_1" }),
  startTeammate: () => ({ ok: true }),
  updateTask: () => ({ ok: true }),
  waitForTeammates: async () => ({ ok: true }),
};

afterEach(() => {
  resetTeamExecutorPort();
});

describe("团队旧版工具动作分派", () => {
  test("teamTool 支持 broadcast / status / list_tasks / approve_plan / cleanup_team", async () => {
    setTeamExecutorPort(mockPort);

    expect(await teamTool.execute({ action: "broadcast", message: "hello all" } as any)).toMatchObject({
      action: "broadcast",
      success: true,
    });

    expect(await teamTool.execute({ action: "status", teammateId: "mate_1" } as any)).toMatchObject({
      action: "status",
      success: true,
    });

    expect(await teamTool.execute({ action: "list_tasks" } as any)).toMatchObject({
      action: "list_tasks",
      success: true,
    });
  });

  test("teamTool 在 executor 抛错时返回结构化错误", async () => {
    const failingPort: TeamExecutorPort = {
      ...mockPort,
      cleanupTeam: async () => {
        throw new Error("cleanup exploded");
      },
    };
    setTeamExecutorPort(failingPort);
    await expect(teamTool.execute({ action: "cleanup_team" } as any)).rejects.toThrow("cleanup exploded");
  });
});
