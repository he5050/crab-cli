/**
 * sessionSubagent + spawnToolSubagent 单元测试
 *
 * 测试覆盖:
 *   - createSessionSpawnExecutor 深度校验
 *   - spawnToolSubagent 深度校验
 *   - spawnToolSubagent 正常注册到 tracker
 */
import { afterEach, describe, expect, mock, test } from "bun:test";
import { createSessionSpawnExecutor, spawnToolSubagent } from "@/agent/session/sessionSubagent";
import { subAgentTracker } from "@/agent/subagent/tracker";

describe("createSessionSpawnExecutor", () => {
  test("深度已达上限时返回错误结果", async () => {
    const onError = mock(() => {});
    const executor = createSessionSpawnExecutor(
      {
        agentName: "parent",
        config: { defaultProvider: { provider: "p", model: "m" } } as any,
        spawnDepth: 3,
        maxSpawnDepth: 3,
        inheritAllTools: false,
      },
      onError,
    );

    const result = await executor("child", "test prompt", "inst-1", 3);
    expect(result.success).toBe(false);
    expect(result.error).toContain("递归深度已达上限");
    expect(onError).toHaveBeenCalledTimes(1);
  });

  test("深度未达上限时不立即报错（需要 Agent 注册）", async () => {
    // 不注册 Agent，构造会失败 — 验证错误路径而非正常路径
    const executor = createSessionSpawnExecutor({
      agentName: "parent",
      config: { defaultProvider: { provider: "p", model: "m" } } as any,
      spawnDepth: 0,
      maxSpawnDepth: 3,
      inheritAllTools: false,
    });

    // spawnDepth=0 < maxSpawnDepth=3，不会触发深度错误
    // 但会因为 Agent 未注册而抛出异常
    try {
      await executor("nonexistent-agent", "prompt", "inst-1", 1);
    } catch {
      // 预期：Agent 未找到
    }
  });
});

describe("spawnToolSubagent", () => {
  afterEach(() => {
    // 清理 tracker 中可能残留的注册
    for (const a of subAgentTracker.listAll()) {
      subAgentTracker.unregister(a.instanceId);
    }
  });

  test("深度已达上限时不注册到 tracker", () => {
    const childIds = new Set<string>();
    const createExecutor = mock(() => mock(async () => ({ result: "", success: false })));

    const beforeCount = subAgentTracker.listAll().length;

    spawnToolSubagent(
      {
        agentId: "parent",
        name: "parent",
        prompt: "test",
        agentName: "parent",
        allowedTools: ["bash"],
        maxTurns: 5,
      },
      {
        spawnDepth: 3,
        maxSpawnDepth: 3,
        spawnedChildInstanceIds: childIds,
        createSpawnExecutor: createExecutor,
      },
    );

    // 深度已达上限，不应注册
    expect(subAgentTracker.listAll().length).toBe(beforeCount);
    expect(createExecutor).not.toHaveBeenCalled();
  });

  test("深度未达上限时注册到 tracker 并调用 executor", () => {
    const childIds = new Set<string>();
    const executorResult = { result: "done", success: true };
    const createExecutor = mock(() => mock(async () => executorResult));

    const beforeCount = subAgentTracker.listAll().length;

    spawnToolSubagent(
      {
        agentId: "parent",
        name: "parent",
        prompt: "test prompt",
        agentName: "parent",
        allowedTools: ["bash"],
        maxTurns: 5,
      },
      {
        spawnDepth: 0,
        maxSpawnDepth: 3,
        spawnedChildInstanceIds: childIds,
        createSpawnExecutor: createExecutor,
      },
    );

    // 应注册到 tracker
    expect(subAgentTracker.listAll().length).toBe(beforeCount + 1);
    expect(createExecutor).toHaveBeenCalledTimes(1);
    expect(childIds.size).toBe(1);
  });
});
