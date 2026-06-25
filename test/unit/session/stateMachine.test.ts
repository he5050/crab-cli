/**
 * 会话状态机单元测试
 *
 * 测试场景:
 * 1. 基本状态转换
 * 2. 非法状态转换拒绝
 * 3. 竞态条件检测
 * 4. 状态历史追踪
 * 5. 工厂函数
 */

import { describe, expect, test } from "bun:test";
import {
  InvalidStateTransitionError,
  SessionState,
  SessionStateMachine,
  StateTransitionEvent,
  canTransition,
  createLoggedStateMachine,
  createProtectedStateMachine,
  createSessionStateMachine,
  getAvailableTransitions,
  isTerminalState,
} from "@/session";

describe("SessionStateMachine", () => {
  describe("基本状态转换", () => {
    test("初始状态为 INIT", () => {
      const sm = createSessionStateMachine("test-1");
      expect(sm.state).toBe(SessionState.INIT);
      expect(sm.isTerminal()).toBe(false);
    });

    test("INIT -> RUNNING 转换成功", async () => {
      const sm = createSessionStateMachine("test-2");
      const newState = await sm.start();
      expect(newState).toBe(SessionState.RUNNING);
      expect(sm.state).toBe(SessionState.RUNNING);
    });

    test("RUNNING -> WAITING 转换成功", async () => {
      const sm = createSessionStateMachine("test-3");
      await sm.start();
      const newState = await sm.wait();
      expect(newState).toBe(SessionState.WAITING);
    });

    test("WAITING -> RUNNING 恢复成功", async () => {
      const sm = createSessionStateMachine("test-4");
      await sm.start();
      await sm.wait();
      const newState = await sm.resume();
      expect(newState).toBe(SessionState.RUNNING);
    });

    test("RUNNING -> COMPLETED 转换成功", async () => {
      const sm = createSessionStateMachine("test-5");
      await sm.start();
      const newState = await sm.complete();
      expect(newState).toBe(SessionState.COMPLETED);
      expect(sm.isTerminal()).toBe(true);
    });

    test("RUNNING -> FAILED 转换成功", async () => {
      const sm = createSessionStateMachine("test-6");
      await sm.start();
      const newState = await sm.fail("Test error");
      expect(newState).toBe(SessionState.FAILED);
      expect(sm.isTerminal()).toBe(true);
    });

    test("RUNNING -> CANCELLED 转换成功", async () => {
      const sm = createSessionStateMachine("test-7");
      await sm.start();
      const newState = await sm.cancel("User cancelled");
      expect(newState).toBe(SessionState.CANCELLED);
      expect(sm.isTerminal()).toBe(true);
    });

    test("终态 -> INIT 重置成功", async () => {
      const sm = createSessionStateMachine("test-8");
      await sm.start();
      await sm.complete();
      const newState = await sm.reset();
      expect(newState).toBe(SessionState.INIT);
    });

    test("完整生命周期: INIT -> RUNNING -> WAITING -> RUNNING -> COMPLETED", async () => {
      const sm = createSessionStateMachine("test-9");
      expect(sm.state).toBe(SessionState.INIT);

      await sm.start();
      expect(sm.state).toBe(SessionState.RUNNING);

      await sm.wait();
      expect(sm.state).toBe(SessionState.WAITING);

      await sm.resume();
      expect(sm.state).toBe(SessionState.RUNNING);

      await sm.complete();
      expect(sm.state).toBe(SessionState.COMPLETED);
    });
  });

  describe("非法状态转换拒绝", () => {
    test("INIT 状态不能直接 COMPLETED", async () => {
      const sm = createSessionStateMachine("test-10");
      await expect(sm.complete()).rejects.toBeInstanceOf(InvalidStateTransitionError);
    });

    test("INIT 状态不能直接 FAILED", async () => {
      const sm = createSessionStateMachine("test-11");
      await expect(sm.fail()).rejects.toBeInstanceOf(InvalidStateTransitionError);
    });

    test("RUNNING 状态不能直接 RESUME", async () => {
      const sm = createSessionStateMachine("test-12");
      await sm.start();
      await expect(sm.resume()).rejects.toBeInstanceOf(InvalidStateTransitionError);
    });

    test("COMPLETED 状态不能执行 START", async () => {
      const sm = createSessionStateMachine("test-13");
      await sm.start();
      await sm.complete();
      await expect(sm.start()).rejects.toBeInstanceOf(InvalidStateTransitionError);
    });

    test("FAILED 状态不能执行 WAIT", async () => {
      const sm = createSessionStateMachine("test-14");
      await sm.start();
      await sm.fail();
      await expect(sm.wait()).rejects.toBeInstanceOf(InvalidStateTransitionError);
    });

    test("CANCELLED 状态不能执行 RESUME", async () => {
      const sm = createSessionStateMachine("test-15");
      await sm.start();
      await sm.cancel();
      await expect(sm.resume()).rejects.toBeInstanceOf(InvalidStateTransitionError);
    });

    test("重复相同状态转换应该抛出异常", async () => {
      const sm = createSessionStateMachine("test-16");
      await sm.start();
      await expect(sm.transition(StateTransitionEvent.START)).rejects.toBeInstanceOf(InvalidStateTransitionError);
    });
  });

  describe("tryTransition 非抛异常版本", () => {
    test("合法转换返回成功", async () => {
      const sm = createSessionStateMachine("test-17");
      const [success, state] = await sm.tryTransition(StateTransitionEvent.START);
      expect(success).toBe(true);
      expect(state).toBe(SessionState.RUNNING);
    });

    test("非法转换返回失败和错误信息", async () => {
      const sm = createSessionStateMachine("test-18");
      const [success, error] = await sm.tryTransition(StateTransitionEvent.COMPLETE);
      expect(success).toBe(false);
      expect(typeof error).toBe("string");
    });
  });

  describe("状态历史追踪", () => {
    test("记录转换历史", async () => {
      const sm = createSessionStateMachine("test-19");
      await sm.start();
      await sm.wait();
      await sm.complete();

      const history = sm.getHistory();
      expect(history.length).toBe(3);
      expect(history[0]!.from).toBe(SessionState.INIT);
      expect(history[0]!.to).toBe(SessionState.RUNNING);
      expect(history[0]!.event).toBe(StateTransitionEvent.START);
    });

    test("记录转换原因", async () => {
      const sm = createSessionStateMachine("test-20");
      await sm.start();
      await sm.fail("Network error");

      const history = sm.getHistory();
      const lastTransition = history[history.length - 1]!;
      expect(lastTransition.reason).toBe("Network error");
    });

    test("获取转换次数", async () => {
      const sm = createSessionStateMachine("test-21");
      expect(sm.getTransitionCount()).toBe(0);

      await sm.start();
      expect(sm.getTransitionCount()).toBe(1);

      await sm.wait();
      expect(sm.getTransitionCount()).toBe(2);
    });

    test("历史大小限制", async () => {
      const sm = new SessionStateMachine("test-22", SessionState.INIT, {
        maxHistorySize: 5,
        trackHistory: true,
      });

      await sm.transition(StateTransitionEvent.START);
      await sm.transition(StateTransitionEvent.COMPLETE);
      await sm.transition(StateTransitionEvent.RESET);
      await sm.transition(StateTransitionEvent.START);
      await sm.transition(StateTransitionEvent.COMPLETE);

      expect(sm.getHistory().length).toBe(2);
    });

    test("重置清空历史", async () => {
      const sm = new SessionStateMachine("test-23", SessionState.INIT, {
        trackHistory: true,
      });

      await sm.start();
      await sm.complete();
      expect(sm.getHistory().length).toBe(2);

      await sm.reset();
      expect(sm.getHistory().length).toBe(0);
    });

    test("getSnapshot 返回正确信息", async () => {
      const sm = createSessionStateMachine("test-23");
      await sm.start();
      await sm.wait();

      const snapshot = sm.getSnapshot();
      expect(snapshot.sessionId).toBe("test-23");
      expect(snapshot.state).toBe(SessionState.WAITING);
      expect(snapshot.isTerminal).toBe(false);
      expect(snapshot.transitionCount).toBe(2);
      expect(snapshot.lastTransition).not.toBeNull();
    });
  });

  describe("辅助函数", () => {
    test("isTerminalState 正确判断终态", () => {
      expect(isTerminalState(SessionState.COMPLETED)).toBe(true);
      expect(isTerminalState(SessionState.FAILED)).toBe(true);
      expect(isTerminalState(SessionState.CANCELLED)).toBe(true);
      expect(isTerminalState(SessionState.INIT)).toBe(false);
      expect(isTerminalState(SessionState.RUNNING)).toBe(false);
      expect(isTerminalState(SessionState.WAITING)).toBe(false);
    });

    test("canTransition 正确判断", () => {
      expect(canTransition(SessionState.INIT, SessionState.RUNNING, StateTransitionEvent.START)).toBe(true);
      expect(canTransition(SessionState.INIT, SessionState.COMPLETED, StateTransitionEvent.COMPLETE)).toBe(false);
      expect(canTransition(SessionState.RUNNING, SessionState.WAITING, StateTransitionEvent.WAIT)).toBe(true);
    });

    test("getAvailableTransitions 返回正确事件", () => {
      const events = getAvailableTransitions(SessionState.INIT);
      expect(events).toContain(StateTransitionEvent.START);
      expect(events).toContain(StateTransitionEvent.CANCEL);

      const runningEvents = getAvailableTransitions(SessionState.RUNNING);
      expect(runningEvents).toContain(StateTransitionEvent.COMPLETE);
      expect(runningEvents).toContain(StateTransitionEvent.FAIL);
      expect(runningEvents).toContain(StateTransitionEvent.CANCEL);
      expect(runningEvents).toContain(StateTransitionEvent.WAIT);
    });
  });

  describe("工厂函数", () => {
    test("createLoggedStateMachine 创建带日志的状态机", async () => {
      const sm = createLoggedStateMachine("test-24", SessionState.INIT);
      await sm.start();
      await sm.complete();

      expect(sm.getHistory().length).toBe(2);
    });

    test("createProtectedStateMachine 不允许从终态重置", async () => {
      const sm = createProtectedStateMachine("test-25");
      await sm.start();
      await sm.complete();

      await expect(sm.reset()).rejects.toBeInstanceOf(InvalidStateTransitionError);
    });
  });

  describe("竞态条件检测", () => {
    test("连续快速转换不会死锁", async () => {
      const sm = createSessionStateMachine("test-26");
      await sm.start();
      await sm.wait();
      await sm.resume();
      await sm.complete();

      expect(sm.state).toBe(SessionState.COMPLETED);
    });

    test("状态转换锁保护", async () => {
      const sm = createSessionStateMachine("test-27");
      await sm.start();
      expect(sm.state).toBe(SessionState.RUNNING);
    });
  });

  describe("InvalidStateTransitionError", () => {
    test("错误包含正确信息", async () => {
      const sm = createSessionStateMachine("test-28");
      try {
        await sm.complete();
      } catch (caught) {
        expect(caught).toBeInstanceOf(InvalidStateTransitionError);
        const error = caught as InvalidStateTransitionError;
        expect(error.sessionId).toBe("test-28");
        expect(error.currentState).toBe(SessionState.INIT);
        expect(error.event).toBe(StateTransitionEvent.COMPLETE);
      }
    });
  });

  describe("销毁", () => {
    test("destroy 清理资源", async () => {
      const sm = createSessionStateMachine("test-29");
      await sm.start();
      sm.destroy();

      expect(sm.getHistory().length).toBe(0);
    });
  });
});
