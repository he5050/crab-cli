/**
 * 团队执行器高价值测试。
 *
 * 测试目标:
 *   - 验证 TeamExecutor / executeRegularToolCalls 在高价值场景下的行为
 *
 * 测试用例:
 *   - 工具调用的执行与结果汇总
 *   - mock 依赖在测试结束后被还原
 *   - 临时目录清理
 */
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { TeamExecutor, executeRegularToolCalls } from "@/agent/team";
import { ToolExecutor } from "@/tool/executor/toolExecutor";
import { hookExecutor } from "@/hooks/hookExecutor";

const tick = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

describe("TeamExecutor high-value branches", () => {
  let tempDir: string;
  let executor: TeamExecutor;

  beforeEach(() => {
    mock.restore();
    tempDir = fs.mkdtempSync(path.join("/var/tmp", "team-executor-hv-"));
    fs.mkdirSync(path.join(tempDir, ".crab"), { recursive: true });
    fs.writeFileSync(path.join(tempDir, ".crab", "team.json"), JSON.stringify({ useWorktree: false }));
    executor = new TeamExecutor(tempDir);
  });

  afterEach(() => {
    mock.restore();
    fs.rmSync(tempDir, { force: true, recursive: true });
  });

  test("startTeammate 对不存在和重复运行队友返回错误", async () => {
    expect(executor.startTeammate("ghost", "run").ok).toBe(false);

    const spawn = await executor.spawnMate("runner", "dev", "task");
    expect(spawn.ok).toBe(true);

    executor.getTracker().updateStatus(spawn.teammateId, "running");
    const second = executor.startTeammate(spawn.teammateId, "run-again");

    expect(second.ok).toBe(false);
    expect(String(second.error)).toContain("运行中");
  });

  test("broadcastMessage / dequeueLeadMessages / waitForTeammates / approvePlan 覆盖公共分支", async () => {
    const spawn = await executor.spawnMate("mate-a", "dev", "task-a");
    expect(spawn.ok).toBe(true);

    const broadcast = executor.broadcastMessage("global notice");
    expect(broadcast.ok).toBe(true);
    expect(String(broadcast.output)).toContain("1");

    executor.getTracker().sendMessageToLead(spawn.teammateId, "done");
    executor.getTracker().storeResult({
      name: "mate-a",
      result: "ok",
      success: true,
      teammateId: spawn.teammateId,
    });
    executor.getTracker().setStandby(spawn.teammateId);

    const waited = await executor.waitForTeammates(10);
    expect(waited.ok).toBe(true);
    const payload = JSON.parse(waited.output ?? "{}");
    expect(payload.allStandby).toBe(true);
    expect(payload.leadMessages[0].content).toBe("done");
    expect(payload.results[0].result).toBe("ok");

    executor.getTracker().requestPlanApproval(spawn.teammateId, "plan content");
    const approved = executor.approvePlan(spawn.teammateId, true, "go");
    expect(approved.ok).toBe(true);
    expect(String(approved.output)).toContain("批准");
    expect(executor.approvePlan(spawn.teammateId, true).ok).toBe(false);
  });

  test("shutdownTeammate / cleanupTeam / merge wrappers 失败分快速返回", async () => {
    expect((await executor.shutdownTeammate("ghost")).ok).toBe(false);
    expect((await executor.mergeTeammateWork("ghost", "manual")).ok).toBe(false);

    const spawn = await executor.spawnMate("cleanup-mate", "dev", "task");
    expect(spawn.ok).toBe(true);
    const mate = executor.getTeammate(spawn.teammateId)!;

    const shutdown = await executor.shutdownTeammate(spawn.teammateId);
    expect(shutdown.ok).toBe(true);
    expect(executor.getTeammate(spawn.teammateId)).toBeUndefined();

    executor.getTracker().register({
      id: "mate_running",
      name: "running-mate",
      role: "dev",
      status: "running",
      task: "busy",
      worktreePath: path.join(tempDir, "running-worktree"),
    } as any);

    const blockedCleanup = await executor.cleanupTeam();
    expect(blockedCleanup.ok).toBe(false);
    expect(String(blockedCleanup.error)).toContain("仍在运行");
  });

  test("getRuntimeState / createTask / updateTask / cleanup 覆盖状态包装分支", async () => {
    const runtimeBefore = executor.getRuntimeState();
    expect(runtimeBefore.activeTeamName).toBeNull();

    const created = executor.createTask("shared work", undefined, { title: "Shared" });
    expect(created.ok).toBe(true);
    expect(executor.getRuntimeState().activeTeamName).toBeTruthy();

    const spawn = await executor.spawnMate("worker", "dev", "task");
    expect(spawn.ok).toBe(true);
    expect(executor.updateTask(spawn.teammateId, "progress", "in-progress").ok).toBe(true);
    expect(executor.updateTask(spawn.teammateId, "failed reason", "failed").ok).toBe(true);
    expect(executor.updateTask("ghost", "x", "completed").ok).toBe(false);

    await executor.cleanup();
    expect(executor.getRuntimeState().activeTeamName).toBeNull();
    expect(executor.size).toBe(0);
  });

  test("受控 LLM 流覆盖合成工具分支", async () => {
    executor.setAppConfig({ model: "test-model", providerId: "test", requestMethod: "chat" } as any);

    const shared = executor.createTask("shared desc", undefined, { title: "Shared Task" });
    const sharedTaskId = JSON.parse(shared.output!).taskId as string;
    const teammateB = await executor.spawnMate("mate-b", "qa", "assist");
    const teammateA = await executor.spawnMate("mate-a", "dev", "main");
    executor.getTracker().setStandby(teammateB.teammateId);

    const events: { type: string; toolName?: string; content?: string }[] = [];
    executor.setLlmStream(async function* () {
      yield {
        args: { content: "to lead", target: "lead" },
        toolCallId: "call-1",
        toolName: "message_teammate",
        type: "tool-call" as const,
      };
      yield {
        args: { content: "to mate-b", target: "mate-b" },
        toolCallId: "call-2",
        toolName: "message_teammate",
        type: "tool-call" as const,
      };
      yield {
        args: { task_id: sharedTaskId },
        toolCallId: "call-3",
        toolName: "claim_task",
        type: "tool-call" as const,
      };
      yield {
        args: {},
        toolCallId: "call-4",
        toolName: "list_team_tasks",
        type: "tool-call" as const,
      };
      yield {
        args: { task_id: sharedTaskId },
        toolCallId: "call-5",
        toolName: "complete_task",
        type: "tool-call" as const,
      };
      yield {
        args: { plan: "my plan" },
        toolCallId: "call-6",
        toolName: "request_plan_approval",
        type: "tool-call" as const,
      };
      yield {
        args: { summary: "done summary" },
        toolCallId: "call-7",
        toolName: "wait-for-messages",
        type: "tool-call" as const,
      };
    });

    const started = executor.startTeammate(teammateA.teammateId, "run synthetic flow", {
      onMessage: (msg) => events.push({ content: msg.content, toolName: msg.toolName, type: msg.type }),
    });
    expect(started.ok).toBe(true);

    const waited = await executor.waitForTeammates(1000);
    expect(waited.ok).toBe(true);

    const payload = JSON.parse(waited.output!);
    expect(payload.allStandby).toBe(true);
    expect(payload.leadMessages.some((m: any) => String(m.content).includes("[Standby]"))).toBe(true);
    expect(events.some((e) => e.toolName === "claim_task" && String(e.content).includes("已认领任务"))).toBe(true);
    expect(events.some((e) => e.toolName === "complete_task" && String(e.content).includes("已标记为完成"))).toBe(true);
    expect(events.some((e) => e.toolName === "list_team_tasks" && String(e.content).includes("Shared Task"))).toBe(
      true,
    );
    expect(events.some((e) => e.toolName === "request_plan_approval" && String(e.content).includes("已提交审批"))).toBe(
      true,
    );

    const pending = executor.getPendingApprovals();
    expect(pending.length).toBe(1);
  });

  test("plan approval 批准后解除写工具门控", async () => {
    executor.setAppConfig({ model: "test-model", providerId: "test", requestMethod: "chat" } as any);

    const preHookSpy = spyOn(hookExecutor, "preToolUse").mockResolvedValue({ allowed: true } as any);
    const postHookSpy = spyOn(hookExecutor, "postToolUse").mockResolvedValue(undefined as any);
    const executedTools: string[] = [];
    spyOn(ToolExecutor.prototype, "execute").mockImplementation(async (toolName) => {
      executedTools.push(String(toolName));
      return { error: undefined, output: "write ok", success: true } as any;
    });

    const spawn = await executor.spawnMate("planner", "dev", "write gated task", {
      allowedTools: ["filesystem-write"],
    });
    expect(spawn.ok).toBe(true);

    let round = 0;
    executor.setLlmStream(async function* () {
      round += 1;
      if (round === 1) {
        yield {
          args: { plan: "1. 修改 src/a.ts\n2. 补测试" },
          toolCallId: "plan-1",
          toolName: "request_plan_approval",
          type: "tool-call" as const,
        };
        return;
      }
      if (round === 2) {
        yield {
          args: { content: "ok", filePath: "src/a.ts" },
          toolCallId: "write-1",
          toolName: "filesystem-write",
          type: "tool-call" as const,
        };
        return;
      }
      yield {
        args: { summary: "write completed" },
        toolCallId: "wait-1",
        toolName: "wait-for-messages",
        type: "tool-call" as const,
      };
    });

    const events: { toolName?: string; content?: string }[] = [];
    const started = executor.startTeammate(spawn.teammateId, "start gated work", {
      onMessage: (msg) => {
        events.push({ content: msg.content, toolName: msg.toolName });
        if (msg.toolName === "request_plan_approval" && String(msg.content).includes("等待 lead")) {
          const approved = executor.approvePlan(spawn.teammateId, true, "go");
          expect(approved.ok).toBe(true);
        }
      },
      requirePlanApproval: true,
    });
    expect(started.ok).toBe(true);

    const waited = await executor.waitForTeammates(1000);

    expect(waited.ok).toBe(true);
    expect(executedTools).toEqual(["filesystem-write"]);
    expect(preHookSpy).toHaveBeenCalled();
    expect(postHookSpy).toHaveBeenCalled();
    expect(events.some((e) => e.toolName === "filesystem-write" && String(e.content).includes("write ok"))).toBe(true);
    expect(
      events.some((e) => e.toolName === "filesystem-write" && String(e.content).includes("需要先通过 plan approval")),
    ).toBe(false);
  });

  test("直接覆盖常规工具的白名单 / worktree / hook / execution 分支", async () => {
    const hookSpy = spyOn(hookExecutor, "preToolUse");
    hookSpy.mockResolvedValue({ allowed: true } as any);
    const postSpy = spyOn(hookExecutor, "postToolUse");
    postSpy.mockResolvedValue(undefined as any);
    const execSpy = spyOn(ToolExecutor.prototype, "execute");
    execSpy.mockResolvedValue({ error: undefined, output: "tool ok", success: true } as any);

    const spawned = await executor.spawnMate("guarded", "dev", "task", { allowedTools: ["filesystem-read", "grep"] });
    expect(spawned.ok).toBe(true);
    const mate = executor.getTeammate(spawned.teammateId)!;
    mate.worktreePath = path.join(tempDir, "guarded-worktree");
    const events: { toolName?: string; content?: string }[] = [];
    const messages: any[] = [];
    const options: any = {
      appConfig: { model: "test-model", providerId: "test", requestMethod: "chat" },
      onMessage: (msg: any) => events.push({ content: msg.content, toolName: msg.toolName }),
    };
    const abortController = new AbortController();

    await executeRegularToolCalls({
      abortSignal: abortController.signal,
      appConfig: options.appConfig,
      autoApprove: executor.getConfig().autoApprove,
      calls: [
        {
          args: { content: "x", filePath: "src/a.ts" },
          toolCallId: "blocked-allowedtools",
          toolName: "filesystem-write",
        },
      ],
      mate,
      messages,
      onMessage: options.onMessage,
    });

    await executeRegularToolCalls({
      abortSignal: abortController.signal,
      appConfig: options.appConfig,
      autoApprove: executor.getConfig().autoApprove,
      calls: [
        { args: { filePath: "/outside/project/file.ts" }, toolCallId: "blocked-worktree", toolName: "filesystem-read" },
      ],
      mate,
      messages,
      onMessage: options.onMessage,
    });

    hookSpy.mockResolvedValueOnce({ allowed: false, reason: "hook denied" } as any);
    await executeRegularToolCalls({
      abortSignal: abortController.signal,
      appConfig: options.appConfig,
      autoApprove: executor.getConfig().autoApprove,
      calls: [{ args: { filePath: "src/ok.ts" }, toolCallId: "blocked-hook", toolName: "filesystem-read" }],
      mate,
      messages,
      onMessage: options.onMessage,
    });

    await executeRegularToolCalls({
      abortSignal: abortController.signal,
      appConfig: options.appConfig,
      autoApprove: executor.getConfig().autoApprove,
      calls: [{ args: { path: "src", pattern: "TODO" }, toolCallId: "tool-success", toolName: "grep" }],
      mate,
      messages,
      onMessage: options.onMessage,
    });

    expect(messages.length).toBeGreaterThanOrEqual(4);
    expect(execSpy).toHaveBeenCalled();
    expect(hookSpy).toHaveBeenCalledTimes(2);
    expect(postSpy).toHaveBeenCalled();
    expect(events.some((e) => e.toolName === "filesystem-write" && String(e.content).includes("allowedTools"))).toBe(
      true,
    );
    expect(events.some((e) => e.toolName === "filesystem-read" && String(e.content).includes("worktree 之外"))).toBe(
      true,
    );
    expect(messages.some((m) => JSON.stringify(m).includes("hook denied"))).toBe(true);
  });
});
