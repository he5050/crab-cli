/**
 * SubAgent 工具审批测试。
 *
 * 测试目标:
 *   - 验证 subAgent 工具审批逻辑:会话已批准工具集合、终止指令收集等
 *
 * 测试用例:
 *   - 会话级已批准工具集合能命中工具并跳过审批
 *   - 终止指令在被收集到后能正确影响 subAgent 生命周期
 */
// @ts-nocheck
import { beforeEach, describe, expect, mock, test } from "bun:test";

function createContext(overrides: Record<string, unknown> = {}) {
  return {
    collectedTerminationInstructions: [],
    messages: [],
    sessionApprovedTools: new Set<string>(),
    ...overrides,
  };
}

function toolCall(id: string, name: string, args: string) {
  return {
    function: {
      arguments: args,
      name,
    },
    id,
  };
}

describe("subAgentToolApproval", () => {
  beforeEach(() => {
    mock.restore();
  });

  test("checkAndApproveTools 处理 approve_always 并复用 session 审批", async () => {
    const mod = await import("@/agent/subagent/toolApproval.ts");
    const added: string[] = [];
    let confirmations = 0;
    const ctx = createContext({
      addToAlwaysApproved: (toolName: string) => added.push(toolName),
      requestToolConfirmation: async () => {
        confirmations++;
        return "approve_always";
      },
    });
    const call = toolCall("tc-1", "filesystem-read", '{"path":"README.md"}');

    const first = await mod.checkAndApproveTools(ctx, [call]);
    const second = await mod.checkAndApproveTools(
      {
        ...ctx,
        requestToolConfirmation: async () => {
          confirmations++;
          return "reject";
        },
      },
      [call],
    );

    expect(first.approvedToolCalls).toEqual([call]);
    expect(first.shouldContinue).toBe(false);
    expect(ctx.sessionApprovedTools.has("filesystem-read")).toBe(true);
    expect(added).toEqual(["filesystem-read"]);
    expect(second.approvedToolCalls).toEqual([call]);
    expect(confirmations).toBe(1);
  });

  test("checkAndApproveTools 处理 reject_with_reply 和畸形参数", async () => {
    const mod = await import("@/agent/subagent/toolApproval.ts");
    const emitted: { tool_call_id: string; content: string }[] = [];
    const seenArgs: unknown[] = [];
    const ctx = createContext({
      emitMessage: (msg: { tool_call_id: string; content: string }) => emitted.push(msg),
      requestToolConfirmation: async (_toolName: string, args: Record<string, unknown>) => {
        seenArgs.push(args);
        return { reason: "need wider scope", type: "reject_with_reply" };
      },
    });

    const result = await mod.checkAndApproveTools(ctx, [toolCall("tc-2", "github_search_code", "{invalid-json")]);

    expect(result.approvedToolCalls).toEqual([]);
    expect(result.shouldContinue).toBe(true);
    expect(seenArgs).toEqual([{}]);
    expect(ctx.messages[0]?.content).toContain("need wider scope");
    expect(emitted[0]?.content).toContain("need wider scope");
    expect(ctx.collectedTerminationInstructions).toHaveLength(0);
  });

  test("checkAndApproveTools 将 reject 转为终止指令并取消周边工具", async () => {
    const mod = await import("@/agent/subagent/toolApproval.ts");
    const confirmationDecisions = ["approve", "reject"];
    const ctx = createContext({
      requestToolConfirmation: async () => confirmationDecisions.shift() ?? "approve",
    });
    const calls = [
      toolCall("tc-3a", "filesystem-read", '{"path":"a.ts"}'),
      toolCall("tc-3b", "bash", '{"command":"rm -rf tmp"}'),
      toolCall("tc-3c", "filesystem-write", '{"path":"b.ts"}'),
    ];

    const result = await mod.checkAndApproveTools(ctx, calls);
    const toolMessages = ctx.messages.filter((msg: { role: string }) => msg.role === "tool");

    expect(result.approvedToolCalls).toEqual([]);
    expect(result.shouldContinue).toBe(true);
    expect(toolMessages).toHaveLength(3);
    expect(toolMessages[0]?.content).toContain("工具执行被用户拒绝");
    expect(toolMessages[1]?.content).toContain("工具执行已取消");
    expect(toolMessages[2]?.content).toContain("工具执行已取消");
    expect(ctx.collectedTerminationInstructions).toHaveLength(1);
    expect(ctx.collectedTerminationInstructions[0]).toContain('用户拒绝了工具 "bash"');
    expect(ctx.messages.at(-1)?.role).toBe("user");
  });

  test("executeApprovedToolsWithHooks blocks on pre-hook and skips tool execution", async () => {
    const executeHooks = mock(async () => ({ results: [{ success: false }] }));
    const interpretHookResult = mock((event: string) =>
      event === "PreToolUse" ? { action: "block", replacedContent: "blocked by pre-hook" } : { action: "continue" },
    );
    const mod = await import("@/agent/subagent/toolApproval.ts");
    mod.__setToolApprovalDepsForTesting({
      interpretHookResult: interpretHookResult as any,
      isYoloPassthroughActive: () => false,
      shouldAutoApproveSubAgentTool: () => false,
      unifiedHooksExecutor: { executeHooks } as any,
    });
    const executeTool = mock(async () => ({ ok: true }));
    const ctx = createContext();

    await mod.executeApprovedToolsWithHooks(ctx, [toolCall("tc-4", "filesystem-read", '{"path":"x"}')], executeTool);

    expect(executeTool).not.toHaveBeenCalled();
    expect(ctx.messages[0]?.content).toBe("blocked by pre-hook");
  });

  test("executeApprovedToolsWithHooks replaces post-hook output and reports error path", async () => {
    const executeHooks = mock(async (event: string, payload: Record<string, unknown>) => {
      if (event === "PostToolUse" && payload.isError) {
        return { results: [{ hookName: "post-error", success: true }] };
      }
      return { results: [{ hookName: `hook-${event}`, success: false }] };
    });
    const interpretHookResult = mock((event: string) =>
      event === "PostToolUse" ? { action: "replace", replacedContent: '"post-processed"' } : { action: "continue" },
    );
    const mod = await import("@/agent/subagent/toolApproval.ts");
    mod.__setToolApprovalDepsForTesting({
      interpretHookResult: interpretHookResult as any,
      isYoloPassthroughActive: () => false,
      shouldAutoApproveSubAgentTool: () => false,
      unifiedHooksExecutor: { executeHooks } as any,
    });
    const successCtx = createContext();

    await mod.executeApprovedToolsWithHooks(
      successCtx,
      [toolCall("tc-5", "filesystem-read", '{"path":"x"}')],
      async () => ({ body: "raw", ok: true }),
    );

    expect(successCtx.messages[0]?.content).toBe('"post-processed"');

    const errorCtx = createContext();
    await mod.executeApprovedToolsWithHooks(errorCtx, [toolCall("tc-6", "bash", '{"command":"exit 1"}')], async () => {
      throw new Error("boom");
    });

    expect(errorCtx.messages[0]?.content).toContain("Error: boom");
    expect(
      executeHooks.mock.calls.some(([event, payload]) => event === "PostToolUse" && payload?.isError === true),
    ).toBe(true);
  });

  test("executeApprovedToolsWithHooks tolerates hook failures and aborts early on signal", async () => {
    const executeHooks = mock(async () => {
      throw new Error("hook crashed");
    });
    const mod = await import("@/agent/subagent/toolApproval.ts");
    mod.__setToolApprovalDepsForTesting({
      interpretHookResult: (() => ({ action: "continue" })) as any,
      isYoloPassthroughActive: () => false,
      shouldAutoApproveSubAgentTool: () => false,
      unifiedHooksExecutor: { executeHooks } as any,
    });
    const ctx = createContext();
    const executeTool = mock(async () => ({ ok: true, safe: true }));

    await mod.executeApprovedToolsWithHooks(ctx, [toolCall("tc-7", "filesystem-read", '{"path":"x"}')], executeTool);

    expect(executeTool).toHaveBeenCalled();
    expect(ctx.messages[0]?.content).toContain('"safe":true');

    const controller = new AbortController();
    controller.abort();
    const abortedCtx = createContext({ abortSignal: controller.signal });
    const aborted = await mod.executeApprovedToolsWithHooks(
      abortedCtx,
      [toolCall("tc-8", "filesystem-read", '{"path":"y"}')],
      executeTool,
    );

    expect(aborted.aborted).toBe(true);
    expect(abortedCtx.messages).toHaveLength(0);
  });

  test("checkAndApproveTools 对显式 auto-approved 工具绕过确认", async () => {
    const mod = await import("@/agent/subagent/toolApproval.ts");
    mod.__setToolApprovalDepsForTesting({
      interpretHookResult: (() => ({ action: "continue" })) as any,
      isYoloPassthroughActive: () => false,
      shouldAutoApproveSubAgentTool: () => false,
      unifiedHooksExecutor: { executeHooks: async () => ({ results: [] }) } as any,
    });
    const requestToolConfirmation = mock(async () => "reject");
    const result = await mod.checkAndApproveTools(
      createContext({
        isToolAutoApproved: (toolName: string) => toolName === "filesystem-read",
        requestToolConfirmation,
      }),
      [toolCall("tc-auto", "filesystem-read", '{"path":"safe.txt"}')],
    );

    expect(result.approvedToolCalls).toHaveLength(1);
    expect(requestToolConfirmation).not.toHaveBeenCalled();
  });

  test("checkAndApproveTools 在工具被 runtime auto-approved 时使用 YOLO passthrough", async () => {
    const mod = await import("@/agent/subagent/toolApproval.ts");
    mod.__setToolApprovalDepsForTesting({
      interpretHookResult: (() => ({ action: "continue" })) as any,
      isYoloPassthroughActive: () => true,
      shouldAutoApproveSubAgentTool: (toolName: string) => toolName === "zread_get_trending",
      unifiedHooksExecutor: { executeHooks: async () => ({ results: [] }) } as any,
    });
    const requestToolConfirmation = mock(async () => "reject");
    const result = await mod.checkAndApproveTools(createContext({ requestToolConfirmation }), [
      toolCall("tc-yolo", "zread_get_trending", '{"limit":5}'),
    ]);

    expect(result.approvedToolCalls).toHaveLength(1);
    expect(requestToolConfirmation).not.toHaveBeenCalled();
  });
});
