import { beforeAll, describe, expect, test } from "bun:test";
import { resolveEffectiveAllowedTools } from "@/agent/session/sessionToolContext";

describe("resolveEffectiveAllowedTools", () => {
  test("父子都有限制时取交集而不是并集", () => {
    const result = resolveEffectiveAllowedTools({
      agentAllowedTools: ["filesystem-read", "terminal-execute"],
      inheritAllTools: false,
      inheritedAllowedTools: ["filesystem-read", "grep"],
      spawnDepth: 0,
    });

    expect(result).toContain("filesystem-read");
    expect(result).not.toContain("terminal-execute");
    expect(result).not.toContain("grep");
  });

  test("仅有父级限制时继承父级工具", () => {
    const result = resolveEffectiveAllowedTools({
      agentAllowedTools: undefined,
      inheritAllTools: false,
      inheritedAllowedTools: ["filesystem-read"],
      spawnDepth: 0,
    });

    expect(result).toContain("filesystem-read");
  });

  test("仅有子级限制时使用子级工具", () => {
    const result = resolveEffectiveAllowedTools({
      agentAllowedTools: ["filesystem-read"],
      inheritAllTools: false,
      inheritedAllowedTools: undefined,
      spawnDepth: 0,
    });

    expect(result).toContain("filesystem-read");
  });

  test("inheritAllTools=true 时返回 undefined（无限制）", () => {
    const result = resolveEffectiveAllowedTools({
      agentAllowedTools: ["bash"],
      inheritAllTools: true,
      inheritedAllowedTools: ["read"],
      spawnDepth: 0,
    });

    expect(result).toBeUndefined();
  });

  test("两侧均为空时返回 undefined（无限制）", () => {
    const result = resolveEffectiveAllowedTools({
      agentAllowedTools: undefined,
      inheritAllTools: false,
      inheritedAllowedTools: undefined,
      spawnDepth: 0,
    });

    expect(result).toBeUndefined();
  });
});

describe("createBuiltinToolInterceptor", () => {
  // 需要导入 — 动态 import 避免循环依赖
  let createBuiltinToolInterceptor: typeof import("@/agent/session/sessionToolContext").createBuiltinToolInterceptor;

  beforeAll(async () => {
    const mod = await import("@/agent/session/sessionToolContext");
    createBuiltinToolInterceptor = mod.createBuiltinToolInterceptor;
  });

  test("非 builtin 工具返回 handled=false", async () => {
    const interceptor = createBuiltinToolInterceptor({
      agentName: "test-agent",
      spawnDepth: 0,
      createSpawnExecutor: () => async () => ({ result: "", success: true }),
      spawnedChildInstanceIds: new Set(),
    });

    const result = await interceptor("bash", "call-1", { command: "ls" }, {} as any);
    expect(result.handled).toBe(false);
  });

  test("askuser-* 工具被拦截返回 handled=true", async () => {
    const interceptor = createBuiltinToolInterceptor({
      agentName: "test-agent",
      spawnDepth: 1,
      askUserCallback: async () => ({ selected: "ok" }),
      createSpawnExecutor: () => async () => ({ result: "", success: true }),
      spawnedChildInstanceIds: new Set(),
    });

    const result = await interceptor("askuser-ask-question", "call-2", { question: "test?" }, {} as any);
    expect(result.handled).toBe(true);
  });
});

describe("buildHandlerOptions", () => {
  let buildHandlerOptions: typeof import("@/agent/session/sessionToolContext").buildHandlerOptions;

  beforeAll(async () => {
    const mod = await import("@/agent/session/sessionToolContext");
    buildHandlerOptions = mod.buildHandlerOptions;
  });

  test("返回包含所有必要字段的 ConversationHandlerOptions", async () => {
    const getToolContext = () => ({ cwd: "", sessionId: "" }) as any;

    const opts = buildHandlerOptions({
      effectiveAllowedTools: ["bash"],
      instanceId: "inst-1",
      spawnDepth: 0,
      options: {
        abortSignal: undefined,
        maxToolRounds: 10,
        sessionId: "sess-1",
      },
      systemPrompt: "be helpful",
      getToolContext,
      toolInterceptor: async () => ({ handled: false }),
    });

    expect(opts.allowedTools).toEqual(["bash"]);
    expect(opts.maxToolRounds).toBe(10);
    expect(opts.sessionId).toBe("sess-1");
    expect(opts.systemPrompt).toBe("be helpful");
    expect(opts.toolInterceptorContext).toEqual({ instanceId: "inst-1" });
  });

  test("缺少可选字段时不报错", async () => {
    const getToolContext = () => ({ cwd: "" }) as any;

    expect(() =>
      buildHandlerOptions({
        effectiveAllowedTools: undefined,
        options: {},
        spawnDepth: 0,
        systemPrompt: "prompt",
        getToolContext,
        toolInterceptor: async () => ({ handled: false }),
      }),
    ).not.toThrow();
  });
});
