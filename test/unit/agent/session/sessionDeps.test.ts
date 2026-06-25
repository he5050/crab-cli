/**
 * sessionDeps 单元测试
 *
 * 测试覆盖:
 *   - 只读 getter 代理行为
 *   - __setAgentSessionDepsForTesting 替换依赖
 *   - __resetAgentSessionDepsForTesting 恢复生产实现
 *   - __setSubagentCollectorForTesting 设置收集器
 */
import { afterEach, describe, expect, test } from "bun:test";
import {
  agentSessionDeps,
  __setAgentSessionDepsForTesting,
  __resetAgentSessionDepsForTesting,
  __setSubagentCollectorForTesting,
} from "@/agent/session/sessionDeps";

describe("agentSessionDeps 只读 getter", () => {
  test("ConversationHandler getter 返回非 undefined", () => {
    expect(agentSessionDeps.ConversationHandler).toBeDefined();
  });

  test("buildAgentRuntimeAugmentations getter 返回非 undefined", () => {
    expect(agentSessionDeps.buildAgentRuntimeAugmentations).toBeDefined();
  });

  test("hookExecutor getter 返回非 undefined", () => {
    expect(agentSessionDeps.hookExecutor).toBeDefined();
  });
});

describe("__setAgentSessionDepsForTesting", () => {
  afterEach(() => {
    __resetAgentSessionDepsForTesting();
  });

  test("替换 ConversationHandler 后 getter 返回新值", () => {
    const mockHandler = { name: "mock-handler" } as any;
    __setAgentSessionDepsForTesting({ ConversationHandler: mockHandler });
    expect(agentSessionDeps.ConversationHandler).toBe(mockHandler);
  });

  test("替换 hookExecutor 后 getter 返回新值", () => {
    const mockExecutor = { name: "mock-executor" } as any;
    __setAgentSessionDepsForTesting({ hookExecutor: mockExecutor });
    expect(agentSessionDeps.hookExecutor).toBe(mockExecutor);
  });

  test("部分替换不影响未替换字段", () => {
    const originalAug = agentSessionDeps.buildAgentRuntimeAugmentations;
    const mockHandler = { name: "mock-handler" } as any;
    __setAgentSessionDepsForTesting({ ConversationHandler: mockHandler });
    expect(agentSessionDeps.ConversationHandler).toBe(mockHandler);
    expect(agentSessionDeps.buildAgentRuntimeAugmentations).toBe(originalAug);
  });
});

describe("__resetAgentSessionDepsForTesting", () => {
  test("恢复后 ConversationHandler 不再是测试 mock", () => {
    const mockHandler = { name: "mock-handler" } as any;
    __setAgentSessionDepsForTesting({ ConversationHandler: mockHandler });
    expect(agentSessionDeps.ConversationHandler).toBe(mockHandler);

    __resetAgentSessionDepsForTesting();
    expect(agentSessionDeps.ConversationHandler).not.toBe(mockHandler);
  });
});

describe("__setSubagentCollectorForTesting", () => {
  afterEach(() => {
    __setSubagentCollectorForTesting(undefined);
  });

  test("设置 collector 后 getter 返回新值", () => {
    const mockCollector = {
      register: () => {},
      unregister: () => {},
      waitForSpawnedAgents: async () => {},
      drainSpawnedResults: () => [],
      drainOrphanedResults: () => [],
      dequeueMessages: () => [],
      dequeueInterAgentMessages: () => [],
      isRunning: () => false,
    };
    __setSubagentCollectorForTesting(mockCollector);
    expect(agentSessionDeps.subagentCollector).toBe(mockCollector);
  });

  test("设为 undefined 后 getter 返回 undefined", () => {
    const mockCollector = {
      register: () => {},
      unregister: () => {},
      waitForSpawnedAgents: async () => {},
      drainSpawnedResults: () => [],
      drainOrphanedResults: () => [],
      dequeueMessages: () => [],
      dequeueInterAgentMessages: () => [],
      isRunning: () => false,
    };
    __setSubagentCollectorForTesting(mockCollector);
    expect(agentSessionDeps.subagentCollector).toBe(mockCollector);

    __setSubagentCollectorForTesting(undefined);
    expect(agentSessionDeps.subagentCollector).toBeUndefined();
  });
});
