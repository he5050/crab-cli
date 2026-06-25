/**
 * [测试目标] 团队工具直接处理器。
 *
 * 测试目标:
 *   - 验证各 team*Tool 工具在空入参、失败回执与成功回执下的关键分支
 *
 * 测试用例:
 *   - spawn / message / approvePlan 关键分支:覆盖空入参失败、spawnMate 失败、spawn 成功但 message 失败等链路
 *   - 其余测试用例分别覆盖 list / status / shutdown / merge_all / merge_work / update_task / list_tasks / create_task / wait / resolve_conflicts / broadcast / cleanup / abort_merge 的成功与异常分支
 */
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { teamExecutor } from "@/agent/team";
import {
  teamAbortMergeTool,
  teamApprovePlanTool,
  teamBroadcastTool,
  teamCleanupTool,
  teamCreateTaskTool,
  teamListTasksTool,
  teamListTool,
  teamMergeAllTool,
  teamMergeWorkTool,
  teamMessageTool,
  teamResolveConflictsTool,
  teamShutdownTool,
  teamSpawnTool,
  teamStatusTool,
  teamUpdateTaskTool,
  teamWaitTool,
} from "@/tool/team";

describe("团队直接处理器工具", () => {
  afterEach(() => {
    // Spies restored individually below
  });

  test("spawn / message / approvePlan 关键分支", async () => {
    expect(((await teamSpawnTool.execute({} as any)) as { success: boolean }).success).toBe(false);
    expect(((await teamMessageTool.execute({} as any)) as { success: boolean }).success).toBe(false);
    expect(((await teamApprovePlanTool.execute({} as any)) as { success: boolean }).success).toBe(false);

    const spawnFail = spyOn(teamExecutor, "spawnMate").mockResolvedValue({ error: "spawn blocked", ok: false } as any);
    expect(await teamSpawnTool.execute({ name: "Alpha" } as any)).toMatchObject({
      error: "spawn blocked",
      success: false,
    });
    spawnFail.mockRestore();

    const spawnOk = spyOn(teamExecutor, "spawnMate").mockResolvedValue({
      ok: true,
      output: JSON.stringify({ name: "Alpha", teammateId: "mate_1" }),
    } as any);
    const startSpy = spyOn(teamExecutor, "startTeammate").mockReturnValue({ ok: true } as any);
    const msgSpy = spyOn(teamExecutor, "messageMate").mockResolvedValue({ error: "offline", ok: false } as any);
    const approveSpy = spyOn(teamExecutor, "approvePlan").mockReturnValue({ ok: true, output: "approved" } as any);

    expect(
      await teamSpawnTool.execute({ name: "Alpha", requirePlanApproval: true, task: "ship it" } as any),
    ).toMatchObject({
      success: true,
      teammateId: "mate_1",
    });
    expect(startSpy).toHaveBeenCalledWith(
      "mate_1",
      expect.stringContaining("ship it"),
      expect.objectContaining({ requirePlanApproval: true }),
    );

    expect(await teamMessageTool.execute({ message: "ping", teammateId: "mate_1" } as any)).toMatchObject({
      error: "offline",
      success: false,
    });
    expect(
      await teamApprovePlanTool.execute({ approved: true, feedback: "go", teammateId: "mate_1" } as any),
    ).toMatchObject({
      action: "approve_plan",
      success: true,
    });

    spawnOk.mockRestore();
    startSpy.mockRestore();
    msgSpy.mockRestore();
    approveSpy.mockRestore();
  });

  test("broadcast / shutdown / status 缺参分支", async () => {
    expect(((await teamBroadcastTool.execute({} as any)) as { success: boolean }).success).toBe(false);
    expect(((await teamShutdownTool.execute({} as any)) as { success: boolean }).success).toBe(false);
    expect(((await teamStatusTool.execute({} as any)) as { success: boolean }).success).toBe(false);
  });

  test("list / status / listTasks 成功映射", async () => {
    const s1 = spyOn(teamExecutor, "listTeammates").mockReturnValue([
      { id: "mate_1", name: "Alpha", role: "dev", status: "running", task: "ship", worktreePath: "/tmp/wt" },
    ] as any);
    const s2 = spyOn(teamExecutor, "getTracker").mockReturnValue({ isOnStandby: () => true } as any);
    const s3 = spyOn(teamExecutor, "getTeammate").mockReturnValue({
      error: undefined,
      name: "Alpha",
      result: "ok",
      role: "dev",
      status: "running",
      task: "ship",
      worktreePath: "/tmp/wt",
    } as any);
    const s4 = spyOn(teamExecutor, "getTaskList").mockReturnValue({
      list: () => [
        {
          assigneeName: "Alpha",
          dependencies: ["d1"],
          description: "Desc",
          id: "t1",
          status: "pending",
          title: "Task",
        },
      ],
    } as any);

    const list = await teamListTool.execute({});
    const status = await teamStatusTool.execute({ teammateId: "mate_1" } as any);
    const tasks = await teamListTasksTool.execute({});

    expect(list).toMatchObject({ success: true, total: 1 });
    expect(status).toMatchObject({ standby: true, success: true, teammateId: "mate_1" });
    expect(tasks).toMatchObject({ success: true, total: 1 });

    s1.mockRestore();
    s2.mockRestore();
    s3.mockRestore();
    s4.mockRestore();
  });

  test("updateTask / createTask 缺参与成功分支", async () => {
    expect(((await teamUpdateTaskTool.execute({} as any)) as { success: boolean }).success).toBe(false);
    expect(((await teamCreateTaskTool.execute({} as any)) as { success: boolean }).success).toBe(false);

    const s1 = spyOn(teamExecutor, "updateTask").mockReturnValue({ ok: true, output: "updated" } as any);
    const s2 = spyOn(teamExecutor, "createTask").mockReturnValue({
      ok: true,
      output: JSON.stringify({ description: "do work", taskId: "t1", title: "Task" }),
    } as any);

    expect(await teamUpdateTaskTool.execute({ taskStatus: "completed", teammateId: "mate_1" } as any)).toMatchObject({
      success: true,
    });
    expect(await teamCreateTaskTool.execute({ name: "Task", task: "do work" } as any)).toMatchObject({
      action: "create_task",
      success: true,
    });

    s1.mockRestore();
    s2.mockRestore();
  });

  test("wait / merge / resolve / abort / cleanup 成功路径", async () => {
    const s1 = spyOn(teamExecutor, "waitForTeammates").mockResolvedValue({
      ok: true,
      output: JSON.stringify({ allStandby: true, leadMessages: [], results: [] }),
    } as any);
    const s2 = spyOn(teamExecutor, "mergeTeammateWork").mockResolvedValue({
      ok: true,
      output: JSON.stringify({ merged: true }),
    } as any);
    const s3 = spyOn(teamExecutor, "mergeAllWork").mockResolvedValue({
      ok: true,
      output: JSON.stringify({ results: [{ name: "A", success: true }] }),
    } as any);
    const s4 = spyOn(teamExecutor, "resolveMergeConflicts").mockResolvedValue({ ok: true, output: "resolved" } as any);
    const s5 = spyOn(teamExecutor, "abortMerge").mockResolvedValue({ ok: true, output: "aborted" } as any);
    const s6 = spyOn(teamExecutor, "cleanupTeam").mockResolvedValue({ ok: true, output: "cleaned" } as any);

    expect(await teamWaitTool.execute({})).toMatchObject({
      action: "wait_for_teammates",
      allStandby: true,
      success: true,
    });
    expect(await teamMergeWorkTool.execute({ strategy: "manual", teammateId: "mate_1" } as any)).toMatchObject({
      action: "merge_work",
      success: true,
    });
    expect(await teamMergeAllTool.execute({ strategy: "auto" } as any)).toMatchObject({
      action: "merge_all",
      success: true,
    });
    expect(await teamResolveConflictsTool.execute({})).toMatchObject({ action: "resolve_conflicts", success: true });
    expect(await teamAbortMergeTool.execute({})).toMatchObject({ action: "abort_merge", success: true });
    expect(await teamCleanupTool.execute({})).toMatchObject({ action: "cleanup_team", success: true });

    s1.mockRestore();
    s2.mockRestore();
    s3.mockRestore();
    s4.mockRestore();
    s5.mockRestore();
    s6.mockRestore();
  });

  test("shutdown / status 失败路径", async () => {
    const s1 = spyOn(teamExecutor, "shutdownTeammate").mockResolvedValue({
      error: "missing teammate",
      ok: false,
    } as any);
    const s2 = spyOn(teamExecutor, "getTeammate").mockReturnValue(undefined as any);

    expect(await teamShutdownTool.execute({ teammateId: "ghost" } as any)).toMatchObject({
      action: "shutdown",
      error: "missing teammate",
      success: false,
    });
    expect(await teamStatusTool.execute({ teammateId: "ghost" } as any)).toMatchObject({
      error: "队友不存在: ghost",
      success: false,
    });

    s1.mockRestore();
    s2.mockRestore();
  });
});
