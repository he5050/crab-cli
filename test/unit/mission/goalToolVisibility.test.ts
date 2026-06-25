/**
 * G-08 动态 Goal 工具可见性测试。
 *
 * 测试用例:
 *   - L2-T19: 无 Goal 时 goal 工具不在工具列表中
 *   - L2-T20: Goal 创建后 goal 工具出现在工具列表中
 *   - L2-T21: Goal 结束后 goal 工具从列表消失
 *   - L2-T22: 工具列表变更后缓存正确重建
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { globalBus } from "@/bus";
import { AppEvent } from "@/bus";
import {
  _getGoalToolVisibilityInstallCountForTesting,
  _isGoalToolVisibilityInitializedForTesting,
  _resetGoalToolRegisteredForTesting,
  clearToolsCache,
  getRegisteredTools,
  setupGoalToolVisibility,
  unregisterTool,
} from "@/tool/registry/toolRegistry";

describe("G-08 动态 Goal 工具可见性", () => {
  beforeAll(() => {
    // 只订阅一次事件，避免多测试叠加 subscriber
    _resetGoalToolRegisteredForTesting();
    setupGoalToolVisibility();
  });

  beforeEach(() => {
    globalBus.clearHistory();
    // 每个测试前确保 goal 工具已注销，恢复干净状态
    _resetGoalToolRegisteredForTesting();
  });

  afterEach(() => {
    // 测试后清理 goal 工具
    const tools = getRegisteredTools();
    if ("goal" in tools) {
      unregisterTool("goal");
      clearToolsCache();
    }
    _resetGoalToolRegisteredForTesting();
  });

  describe("L2-T19: 无 Goal 时 goal 工具不在列表中", () => {
    it("初始状态下 getRegisteredTools 不包含 goal", () => {
      const tools = getRegisteredTools();
      expect(tools["goal"]).toBeUndefined();
    });
  });

  describe("L2-T20: Goal pursuing 时 goal 工具出现", () => {
    it("发布 pursuing 事件后 goal 工具应注册", async () => {
      globalBus.publish(AppEvent.GoalStatusChanged, {
        id: "test-goal-id",
        sessionId: "test-session",
        status: "pursuing",
      });

      // EventBus 使用 queueMicrotask 异步分发，需等待执行
      await new Promise<void>((resolve) => queueMicrotask(resolve));

      const tools = getRegisteredTools();
      expect(tools["goal"]).toBeDefined();
    });
  });

  describe("L2-T21: Goal 结束后 goal 工具消失", () => {
    it("发布 achieved 事件后 goal 工具应注销", async () => {
      // 先激活
      globalBus.publish(AppEvent.GoalStatusChanged, {
        id: "test-goal-id",
        sessionId: "test-session",
        status: "pursuing",
      });
      await new Promise<void>((resolve) => queueMicrotask(resolve));

      let tools = getRegisteredTools();
      expect(tools["goal"]).toBeDefined();

      // 再结束
      globalBus.publish(AppEvent.GoalStatusChanged, {
        id: "test-goal-id",
        sessionId: "test-session",
        status: "achieved",
      });
      await new Promise<void>((resolve) => queueMicrotask(resolve));

      tools = getRegisteredTools();
      expect(tools["goal"]).toBeUndefined();
    });
  });

  describe("L2-T22: 缓存一致性", () => {
    it("unregisterTool 后 clearToolsCache 使下次获取最新列表", async () => {
      // 激活 Goal
      globalBus.publish(AppEvent.GoalStatusChanged, {
        id: "test-goal-id",
        sessionId: "test-session",
        status: "pursuing",
      });
      await new Promise<void>((resolve) => queueMicrotask(resolve));

      let tools = getRegisteredTools();
      expect(tools["goal"]).toBeDefined();

      // 清除缓存
      clearToolsCache();

      // 重新获取，应仍有 goal(注册表中仍有)
      tools = getRegisteredTools();
      expect(tools["goal"]).toBeDefined();

      // 注销 goal 并清除缓存
      unregisterTool("goal");
      clearToolsCache();

      tools = getRegisteredTools();
      expect(tools["goal"]).toBeUndefined();
    });
  });

  describe("L2-T23: 初始化幂等", () => {
    it("重复 setupGoalToolVisibility 不重复安装订阅", () => {
      expect(_isGoalToolVisibilityInitializedForTesting()).toBe(false);

      setupGoalToolVisibility();

      expect(_isGoalToolVisibilityInitializedForTesting()).toBe(true);
      expect(_getGoalToolVisibilityInstallCountForTesting()).toBe(1);

      setupGoalToolVisibility();

      expect(_isGoalToolVisibilityInitializedForTesting()).toBe(true);
      expect(_getGoalToolVisibilityInstallCountForTesting()).toBe(1);
    });
  });
});
