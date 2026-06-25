/**
 * SessionLifecycle 单元测试
 *
 * 测试覆盖:
 *   - updateSessionStatus 合法状态转移
 *   - updateSessionStatus 非法状态转移抛出错误
 *   - updateSessionStatus 同状态短路返回
 *   - destroySession 清理资源
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { updateSessionStatus, destroySession } from "@/agent/session/sessionLifecycle";
import { _resetAll as resetAgentManager } from "@/agent/core/manager";
import { subAgentTracker } from "@/agent/subagent/tracker";

describe("updateSessionStatus", () => {
  test("同状态返回自身", () => {
    const result = updateSessionStatus("idle", "idle", "test-agent");
    expect(result).toBe("idle");
  });

  test("idle -> thinking 合法", () => {
    const result = updateSessionStatus("idle", "thinking", "test-agent");
    expect(result).toBe("thinking");
  });

  test("idle -> running 非法", () => {
    expect(() => updateSessionStatus("idle", "running", "test-agent")).toThrow("非法状态转移");
  });

  test("thinking -> running 合法", () => {
    const result = updateSessionStatus("thinking", "running", "test-agent");
    expect(result).toBe("running");
  });

  test("thinking -> completed 非法", () => {
    expect(() => updateSessionStatus("thinking", "completed", "test-agent")).toThrow("非法状态转移");
  });

  test("running -> completed 合法", () => {
    const result = updateSessionStatus("running", "completed", "test-agent");
    expect(result).toBe("completed");
  });

  test("running -> error 合法", () => {
    const result = updateSessionStatus("running", "error", "test-agent");
    expect(result).toBe("error");
  });

  test("completed -> idle 合法", () => {
    const result = updateSessionStatus("completed", "idle", "test-agent");
    expect(result).toBe("idle");
  });

  test("error -> idle 合法", () => {
    const result = updateSessionStatus("error", "idle", "test-agent");
    expect(result).toBe("idle");
  });

  test("包含原因信息", () => {
    expect(() => updateSessionStatus("idle", "running", "test-agent", "测试原因")).toThrow("测试原因");
  });

  test("所有合法转移路径", () => {
    const validTransitions: Record<string, string[]> = {
      completed: ["idle", "thinking"],
      error: ["idle", "thinking"],
      idle: ["thinking", "error"],
      running: ["completed", "error", "idle"],
      thinking: ["running", "error", "idle"],
    };

    for (const [from, toList] of Object.entries(validTransitions)) {
      for (const to of toList) {
        expect(() => updateSessionStatus(from as any, to as any, "test")).not.toThrow();
      }
    }
  });
});

describe("destroySession", () => {
  beforeEach(() => {
    resetAgentManager();
    // 清理 tracker
    for (const id of subAgentTracker.listAll().map((a) => a.instanceId)) {
      subAgentTracker.unregister(id);
    }
  });

  test("销毁会话并清理资源", () => {
    const destroyMock = mock(() => {});
    const statusMock = mock(() => {});

    const handler = { destroy: destroyMock } as any;
    const spawnedChildInstanceIds = new Set<string>(["child-1", "child-2"]);

    // 注册子代理到 tracker
    subAgentTracker.register({
      agentId: "child-1",
      agentName: "Child 1",
      instanceId: "child-1",
      prompt: "test",
    });
    subAgentTracker.register({
      agentId: "child-2",
      agentName: "Child 2",
      instanceId: "child-2",
      prompt: "test",
    });

    destroySession(
      {
        agentName: "test-agent",
        handler,
        instanceId: "inst-test",
        spawnedChildInstanceIds,
      },
      {
        subagentTasks: [],
        updateStatus: statusMock,
      },
    );

    expect(destroyMock).toHaveBeenCalledTimes(1);
    expect(statusMock).toHaveBeenCalledWith("idle", "Session 销毁");
    expect(spawnedChildInstanceIds.size).toBe(0);
    expect(subAgentTracker.findByInstanceId("child-1")).toBeUndefined();
    expect(subAgentTracker.findByInstanceId("child-2")).toBeUndefined();
    expect(subAgentTracker.findByInstanceId("inst-test")).toBeUndefined();
  });

  test("级联销毁运行中的子代理 session", () => {
    const childDestroyMock = mock(() => {});
    const handler = { destroy: mock(() => {}) } as any;

    const task = {
      agentName: "child-agent",
      createdAt: Date.now(),
      id: "task-1",
      instanceId: "child-inst-1",
      prompt: "test",
      session: { destroy: childDestroyMock } as any,
      status: "running" as const,
    };

    destroySession(
      {
        agentName: "parent-agent",
        handler,
        spawnedChildInstanceIds: new Set(),
      },
      {
        subagentTasks: [task],
        updateStatus: mock(() => {}),
      },
    );

    expect(childDestroyMock).toHaveBeenCalledTimes(1);
  });

  test("子代理销毁失败不阻塞主流程", () => {
    const childDestroyMock = mock(() => {
      throw new Error("destroy failed");
    });
    const handler = { destroy: mock(() => {}) } as any;

    const task = {
      agentName: "child-agent",
      createdAt: Date.now(),
      id: "task-1",
      instanceId: "child-inst-1",
      prompt: "test",
      session: { destroy: childDestroyMock } as any,
      status: "running" as const,
    };

    expect(() =>
      destroySession(
        {
          agentName: "parent-agent",
          handler,
          spawnedChildInstanceIds: new Set(),
        },
        {
          subagentTasks: [task],
          updateStatus: mock(() => {}),
        },
      ),
    ).not.toThrow();

    expect(childDestroyMock).toHaveBeenCalledTimes(1);
  });

  test("非运行中子代理不触发销毁", () => {
    const childDestroyMock = mock(() => {});
    const handler = { destroy: mock(() => {}) } as any;

    const task = {
      agentName: "child-agent",
      createdAt: Date.now(),
      id: "task-1",
      instanceId: "child-inst-1",
      prompt: "test",
      session: { destroy: childDestroyMock } as any,
      status: "completed" as const,
    };

    destroySession(
      {
        agentName: "parent-agent",
        handler,
        spawnedChildInstanceIds: new Set(),
      },
      {
        subagentTasks: [task],
        updateStatus: mock(() => {}),
      },
    );

    expect(childDestroyMock).not.toHaveBeenCalled();
  });
});
