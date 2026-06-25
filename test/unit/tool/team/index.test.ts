import { describe, it, beforeEach, afterEach, expect, mock } from "bun:test";
import { teamTool, teamTools, setTeamExecutorPort, resetTeamExecutorPort } from "@/tool/team/index";
import type { TeamExecutorPort } from "@/tool/team/teamExecutorPort";

/** execute 返回 unknown，测试中需要类型断言 */
interface ToolResult {
  success: boolean;
  error?: string;
  [key: string]: unknown;
}

// ─── Mock Port ────────────────────────────────────────────────────

function createMockPort(): TeamExecutorPort {
  return {
    spawnMate: mock(async () => ({
      ok: true as const,
      output: JSON.stringify({ teammateId: "tm_123" }),
    })),
    startTeammate: mock(() => ({ ok: true as const, output: "started" })),
    messageMate: mock(async () => ({ ok: true as const, output: "delivered" })),
    broadcastMessage: mock(() => ({ ok: true as const, output: "broadcasted" })),
    shutdownTeammate: mock(async () => ({ ok: true as const, output: "shutdown" })),
    waitForTeammates: mock(async () => ({ ok: true as const, output: JSON.stringify({ status: "all standby" }) })),
    cleanupTeam: mock(async () => ({ ok: true as const, output: "cleaned" })),
    getTracker: mock(() => ({ isOnStandby: () => true })),
    listTeammates: mock(() => [
      { id: "tm_123", name: "test", role: "dev", status: "standby", task: "task1", worktreePath: "/tmp/wt" },
    ]),
    getTeammate: mock(() => undefined),
    createTask: mock(() => ({ ok: true as const, output: JSON.stringify({ id: "task_1" }) })),
    updateTask: mock(() => ({ ok: true as const, output: "updated" })),
    getTaskList: mock(() => ({
      list: () => [{ id: "task_1", description: "test", status: "pending", dependencies: [] }],
    })),
    mergeTeammateWork: mock(() => ({ ok: true as const, output: JSON.stringify({ merged: true }) })),
    mergeAllWork: mock(() => ({ ok: true as const, output: JSON.stringify({ mergedAll: true }) })),
    resolveMergeConflicts: mock(async () => ({ ok: true as const, output: "resolved" })),
    abortMerge: mock(async () => ({ ok: true as const, output: "aborted" })),
    approvePlan: mock(() => ({ ok: true as const, output: "approved" })),
  };
}

let mockPort: TeamExecutorPort;

beforeEach(() => {
  mockPort = createMockPort();
  setTeamExecutorPort(mockPort);
});

afterEach(() => {
  resetTeamExecutorPort();
});

// ─── teamTool action dispatch ─────────────────────────────────────

describe("teamTool action dispatch", () => {
  it('action: "spawn" — missing name returns error', async () => {
    const result = (await teamTool.execute({ action: "spawn" })) as ToolResult;
    expect(result.success).toBe(false);
    expect(result.error).toContain("name");
  });

  it('action: "spawn" — valid params returns success with teammateId', async () => {
    const result = (await teamTool.execute({
      action: "spawn",
      name: "mate-1",
      role: "dev",
      task: "do stuff",
    })) as ToolResult;
    expect(result.success).toBe(true);
    expect(result.teammateId).toBe("tm_123");
    expect(mockPort.spawnMate).toHaveBeenCalled();
    expect(mockPort.startTeammate).toHaveBeenCalled();
  });

  it('action: "message" — missing teammateId or message returns error', async () => {
    const r1 = (await teamTool.execute({ action: "message", teammateId: "tm_1" })) as ToolResult;
    expect(r1.success).toBe(false);
    expect(r1.error).toContain("teammateId");

    const r2 = (await teamTool.execute({ action: "message", message: "hello" })) as ToolResult;
    expect(r2.success).toBe(false);
    expect(r2.error).toContain("message");
  });

  it('action: "message" — valid params returns success', async () => {
    const result = (await teamTool.execute({ action: "message", teammateId: "tm_1", message: "hello" })) as ToolResult;
    expect(result.success).toBe(true);
    expect(result.delivered).toBe(true);
    expect(mockPort.messageMate).toHaveBeenCalledWith("tm_1", "hello");
  });

  it('action: "broadcast" — missing message returns error', async () => {
    const result = (await teamTool.execute({ action: "broadcast" })) as ToolResult;
    expect(result.success).toBe(false);
    expect(result.error).toContain("message");
  });

  it('action: "broadcast" — valid params returns success', async () => {
    const result = (await teamTool.execute({ action: "broadcast", message: "hello all" })) as ToolResult;
    expect(result.success).toBe(true);
    expect(result.action).toBe("broadcast");
    expect(mockPort.broadcastMessage).toHaveBeenCalledWith("hello all");
  });

  it('action: "shutdown" — missing teammateId returns error', async () => {
    const result = (await teamTool.execute({ action: "shutdown" })) as ToolResult;
    expect(result.success).toBe(false);
    expect(result.error).toContain("teammateId");
  });

  it('action: "shutdown" — valid params returns success', async () => {
    const result = (await teamTool.execute({ action: "shutdown", teammateId: "tm_1" })) as ToolResult;
    expect(result.success).toBe(true);
    expect(result.action).toBe("shutdown");
    expect(mockPort.shutdownTeammate).toHaveBeenCalledWith("tm_1");
  });

  it('action: "wait_for_teammates" — returns success', async () => {
    const result = (await teamTool.execute({ action: "wait_for_teammates" })) as ToolResult;
    expect(result.success).toBe(true);
    expect(result.action).toBe("wait_for_teammates");
    expect(mockPort.waitForTeammates).toHaveBeenCalled();
  });

  it('action: "list" — returns teammates', async () => {
    const result = (await teamTool.execute({ action: "list" })) as ToolResult;
    expect(result.success).toBe(true);
    expect(result.action).toBe("list");
    expect(result.total).toBe(1);
    expect((result.teammates as unknown[]).length).toBe(1);
    expect((result.teammates as unknown[])[0]).toHaveProperty("id", "tm_123");
    expect(mockPort.listTeammates).toHaveBeenCalled();
    expect(mockPort.getTracker).toHaveBeenCalled();
  });

  it('action: "status" — missing teammateId returns error', async () => {
    const result = (await teamTool.execute({ action: "status" })) as ToolResult;
    expect(result.success).toBe(false);
    expect(result.error).toContain("teammateId");
  });

  it('action: "status" — teammate not found returns error', async () => {
    const result = (await teamTool.execute({ action: "status", teammateId: "tm_nonexistent" })) as ToolResult;
    expect(result.success).toBe(false);
    expect(result.error).toContain("tm_nonexistent");
  });

  it('action: "status" — valid params returns success', async () => {
    mockPort.getTeammate = mock(() => ({
      id: "tm_123",
      name: "mate-1",
      role: "dev",
      status: "standby",
      task: "task1",
      worktreePath: "/tmp/wt",
    }));
    const result = (await teamTool.execute({ action: "status", teammateId: "tm_123" })) as ToolResult;
    expect(result.success).toBe(true);
    expect(result.action).toBe("status");
    expect(result.teammateId).toBe("tm_123");
    expect(result.name).toBe("mate-1");
    expect(mockPort.getTeammate).toHaveBeenCalledWith("tm_123");
  });

  it('action: "create_task" — valid params returns success', async () => {
    const result = (await teamTool.execute({
      action: "create_task",
      task: "do something",
      name: "task-title",
    })) as ToolResult;
    expect(result.success).toBe(true);
    expect(result.action).toBe("create_task");
    expect(result.id).toBe("task_1");
    expect(mockPort.createTask).toHaveBeenCalled();
  });

  it('action: "update_task" — valid params returns success', async () => {
    const result = (await teamTool.execute({
      action: "update_task",
      teammateId: "tm_1",
      taskStatus: "completed",
    })) as ToolResult;
    expect(result.success).toBe(true);
    expect(mockPort.updateTask).toHaveBeenCalledWith("tm_1", undefined, "completed");
  });

  it('action: "list_tasks" — returns tasks', async () => {
    const result = (await teamTool.execute({ action: "list_tasks" })) as ToolResult;
    expect(result.success).toBe(true);
    expect(result.action).toBe("list_tasks");
    expect(result.total).toBe(1);
    expect((result.tasks as unknown[]).length).toBe(1);
    expect((result.tasks as unknown[])[0]).toHaveProperty("id", "task_1");
    expect(mockPort.getTaskList).toHaveBeenCalled();
  });

  it('action: "merge_work" — valid params returns success', async () => {
    const result = (await teamTool.execute({ action: "merge_work", teammateId: "tm_1" })) as ToolResult;
    expect(result.success).toBe(true);
    expect(result.action).toBe("merge_work");
    expect(result.teammateId).toBe("tm_1");
    expect(mockPort.mergeTeammateWork).toHaveBeenCalledWith("tm_1", "manual");
  });

  it('action: "merge_all" — valid params returns success', async () => {
    const result = (await teamTool.execute({ action: "merge_all" })) as ToolResult;
    expect(result.success).toBe(true);
    expect(result.action).toBe("merge_all");
    expect(mockPort.mergeAllWork).toHaveBeenCalledWith("manual");
  });

  it('action: "resolve_conflicts" — returns success', async () => {
    const result = (await teamTool.execute({ action: "resolve_conflicts" })) as ToolResult;
    expect(result.success).toBe(true);
    expect(result.action).toBe("resolve_conflicts");
    expect(mockPort.resolveMergeConflicts).toHaveBeenCalled();
  });

  it('action: "abort_merge" — returns success', async () => {
    const result = (await teamTool.execute({ action: "abort_merge" })) as ToolResult;
    expect(result.success).toBe(true);
    expect(result.action).toBe("abort_merge");
    expect(mockPort.abortMerge).toHaveBeenCalled();
  });

  it('action: "approve_plan" — valid params returns success', async () => {
    const result = (await teamTool.execute({
      action: "approve_plan",
      teammateId: "tm_1",
      approved: true,
      feedback: "looks good",
    })) as ToolResult;
    expect(result.success).toBe(true);
    expect(result.action).toBe("approve_plan");
    expect(mockPort.approvePlan).toHaveBeenCalledWith("tm_1", true, "looks good");
  });

  it('action: "cleanup_team" — returns success', async () => {
    const result = (await teamTool.execute({ action: "cleanup_team" })) as ToolResult;
    expect(result.success).toBe(true);
    expect(result.action).toBe("cleanup_team");
    expect(mockPort.cleanupTeam).toHaveBeenCalled();
  });

  it("action: unknown — returns error", async () => {
    const result = (await teamTool.execute({ action: "unknown_action" as "spawn" })) as ToolResult;
    expect(result.success).toBe(false);
    expect(result.error).toContain("unknown_action");
  });
});

// ─── teamTools array ───────────────────────────────────────────────

describe("teamTools array", () => {
  it("exports exactly 16 tools", () => {
    expect(teamTools).toHaveLength(16);
  });

  it("each tool has name, description, parameters, execute, permission", () => {
    for (const tool of teamTools) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.parameters).toBeDefined();
      expect(typeof tool.execute).toBe("function");
      expect(tool.permission).toMatch(/^team(\.|$)/);
    }
  });

  const expectedNames = [
    "team-spawn",
    "team-message",
    "team-broadcast",
    "team-shutdown",
    "team-wait",
    "team-list",
    "team-status",
    "team-create-task",
    "team-update-task",
    "team-list-tasks",
    "team-merge-work",
    "team-merge-all",
    "team-resolve-conflicts",
    "team-abort-merge",
    "team-approve-plan",
    "team-cleanup",
  ];

  it("contains tools with expected names", () => {
    const names = teamTools.map((t) => t.name);
    expect(names).toEqual(expectedNames);
  });
});

// ─── teamTool (legacy) definition ──────────────────────────────────

describe("teamTool (legacy) definition", () => {
  it("has name 'team'", () => {
    expect(teamTool.name).toBe("team");
  });

  it("has permission 'team'", () => {
    expect(teamTool.permission).toBe("team");
  });
});
