/**
 * SessionStateManager 测试。
 *
 * 测试用例:
 *   - getOrCreate / get / destroy 生命周期
 *   - 状态机迁移:INIT → RUNNING → WAITING → RUNNING → COMPLETED
 *   - 多 manager 隔离
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { AppEvent, globalBus } from "@/bus";
import {
  destroyAllSessionStateManagers,
  destroySessionStateManager,
  getAllSessionStateManagers,
  getOrCreateSessionStateManager,
  getSessionStateManager,
  SessionState,
  StateTransitionEvent,
} from "@/session";

describe("SessionStateManager", () => {
  beforeEach(() => {
    destroyAllSessionStateManagers();
  });

  describe("生命周期:INIT → RUNNING → WAITING → RUNNING → COMPLETED", () => {
    test("start 触发 INIT→RUNNING 迁移", async () => {
      const m = getOrCreateSessionStateManager("lifecycle-1");
      expect(m.state).toBe(SessionState.INIT);
      expect(m.status).toBe("idle");

      await expect(m.start()).resolves.toBe(true);
      expect(m.state).toBe(SessionState.RUNNING);
      expect(m.status).toBe("busy");
    });

    test("等待转换 RUNNING→WAITING", async () => {
      const m = getOrCreateSessionStateManager("lifecycle-2");
      await m.start();

      await expect(m.wait()).resolves.toBe(true);
      expect(m.state).toBe(SessionState.WAITING);
      expect(m.status).toBe("waiting");
    });

    test("恢复转换 WAITING→RUNNING", async () => {
      const m = getOrCreateSessionStateManager("lifecycle-3");
      await m.start();
      await m.wait();

      await expect(m.resume()).resolves.toBe(true);
      expect(m.state).toBe(SessionState.RUNNING);
      expect(m.status).toBe("busy");
    });

    test("complete 转换 RUNNING→COMPLETED", async () => {
      const m = getOrCreateSessionStateManager("lifecycle-4");
      await m.start();

      await expect(m.complete()).resolves.toBe(true);
      expect(m.state).toBe(SessionState.COMPLETED);
      expect(m.status).toBe("completed");
    });

    test("可从 COMPLETED 重置回 INIT", async () => {
      const m = getOrCreateSessionStateManager("lifecycle-5");
      await m.start();
      await m.complete();

      await expect(m.reset()).resolves.toBe(true);
      expect(m.state).toBe(SessionState.INIT);
    });
  });

  describe("生命周期: INIT → RUNNING → FAILED → INIT", () => {
    test("失败转换 RUNNING→FAILED", async () => {
      const m = getOrCreateSessionStateManager("fail-cycle");
      await m.start();

      await expect(m.fail()).resolves.toBe(true);
      expect(m.state).toBe(SessionState.FAILED);
      expect(m.status).toBe("error");
    });

    test("重置从 FAILED", async () => {
      const m = getOrCreateSessionStateManager("fail-reset");
      await m.start();
      await m.fail();

      await expect(m.reset()).resolves.toBe(true);
      expect(m.state).toBe(SessionState.INIT);
    });
  });

  describe("生命周期: INIT → CANCELLED → INIT", () => {
    test("从 INIT 取消", async () => {
      const m = getOrCreateSessionStateManager("cancel-init");
      await expect(m.cancel()).resolves.toBe(true);
      expect(m.state).toBe(SessionState.CANCELLED);
      expect(m.status).toBe("cancelled");
    });

    test("cancel 转换 RUNNING→CANCELLED", async () => {
      const m = getOrCreateSessionStateManager("cancel-running");
      await m.start();
      await expect(m.cancel()).resolves.toBe(true);
      expect(m.state).toBe(SessionState.CANCELLED);
    });

    test("重置从 CANCELLED", async () => {
      const m = getOrCreateSessionStateManager("cancel-reset");
      await m.cancel();
      await expect(m.reset()).resolves.toBe(true);
      expect(m.state).toBe(SessionState.INIT);
    });
  });

  describe("状态查询", () => {
    test("isTerminal returns true for COMPLETED/FAILED/CANCELLED", async () => {
      const m = getOrCreateSessionStateManager("terminal");
      expect(m.isTerminal()).toBe(false);

      await m.start();
      expect(m.isTerminal()).toBe(false);

      await m.complete();
      expect(m.isTerminal()).toBe(true);
    });

    test("canExecute 对非终态 active 状态返回 true", async () => {
      const m = getOrCreateSessionStateManager("can-exec");
      expect(m.canExecute()).toBe(true);

      await m.start();
      expect(m.canExecute()).toBe(true);

      await m.wait();
      expect(m.canExecute()).toBe(true);

      await m.complete();
      expect(m.canExecute()).toBe(false);
    });

    test("canAcceptInput 仅在 INIT 中为 true", async () => {
      const m = getOrCreateSessionStateManager("accept-input");
      expect(m.canAcceptInput()).toBe(true);

      await m.start();
      expect(m.canAcceptInput()).toBe(false);
    });
  });

  describe("getSnapshot", () => {
    test("返回完成状态快照", async () => {
      const m = getOrCreateSessionStateManager("snapshot");
      const snap1 = m.getSnapshot();
      expect(snap1.sessionId).toBe("snapshot");
      expect(snap1.status).toBe("idle");
      expect(snap1.rawState).toBe(SessionState.INIT);
      expect(snap1.isTerminal).toBe(false);
      expect(snap1.canExecute).toBe(true);
      expect(snap1.transitionCount).toBe(0);
      expect(snap1.lastTransition).toBeNull();

      await m.start("unit test");
      const snap2 = m.getSnapshot();
      expect(snap2.status).toBe("busy");
      expect(snap2.rawState).toBe(SessionState.RUNNING);
      expect(snap2.transitionCount).toBe(1);
      expect(snap2.lastTransition).not.toBeNull();
      expect(snap2.lastTransition!.from).toBe(SessionState.INIT);
      expect(snap2.lastTransition!.to).toBe(SessionState.RUNNING);
    });
  });

  describe("getHistory 与 getTransitionCount", () => {
    test("跟踪完整转换历史", async () => {
      const m = getOrCreateSessionStateManager("history");
      expect(m.getTransitionCount()).toBe(0);
      expect(m.getHistory()).toHaveLength(0);

      await m.start();
      expect(m.getTransitionCount()).toBe(1);
      expect(m.getHistory()).toHaveLength(1);
      expect(m.getHistory()[0]!.event).toBe(StateTransitionEvent.START);

      await m.wait();
      expect(m.getTransitionCount()).toBe(2);
      expect(m.getHistory()).toHaveLength(2);
    });
  });

  describe("事件发布", () => {
    test("状态迁移只发布一次 SessionStatusChanged", async () => {
      const received: Array<{ sessionId: string; status: string; previousStatus: string }> = [];
      const unsub = globalBus.subscribe(AppEvent.SessionStatusChanged, (evt: any) => {
        received.push(evt.properties);
      });

      try {
        const m = getOrCreateSessionStateManager("event-once");
        received.length = 0;

        await m.start("single publish");

        expect(received).toHaveLength(1);
        expect(received[0]!.sessionId).toBe("event-once");
        expect(received[0]!.previousStatus).toBe("idle");
        expect(received[0]!.status).toBe("busy");
      } finally {
        unsub();
      }
    });
  });

  describe("tryTransition", () => {
    test("valid transition returns [true, newState]", async () => {
      const m = getOrCreateSessionStateManager("try-valid");
      const [ok, state] = await m.tryTransition(StateTransitionEvent.START);
      expect(ok).toBe(true);
      expect(state).toBe(SessionState.RUNNING);
    });

    test("invalid transition returns [false, errorMessage]", async () => {
      const m = getOrCreateSessionStateManager("try-invalid");
      const [ok, state] = await m.tryTransition(StateTransitionEvent.COMPLETE);
      expect(ok).toBe(false);
      expect(typeof state).toBe("string");
    });
  });

  describe("module-level functions", () => {
    test("getSessionStateManager 返回空值为未知会话", () => {
      expect(getSessionStateManager("nonexistent")).toBeNull();
    });

    test("getSessionStateManager 返回现有管理器", () => {
      getOrCreateSessionStateManager("existing");
      expect(getSessionStateManager("existing")).not.toBeNull();
    });

    test("getAllSessionStateManagers 返回全部管理器", () => {
      getOrCreateSessionStateManager("all-1");
      getOrCreateSessionStateManager("all-2");
      expect(getAllSessionStateManagers().size).toBe(2);
    });

    test("destroySessionStateManager returns false for unknown session", () => {
      expect(destroySessionStateManager("ghost")).toBe(false);
    });

    test("destroySessionStateManager 移除特定管理器", () => {
      getOrCreateSessionStateManager("doomed");
      expect(destroySessionStateManager("doomed")).toBe(true);
      expect(getSessionStateManager("doomed")).toBeNull();
    });

    test("destroyAllSessionStateManagers 返回统计与清理上", () => {
      getOrCreateSessionStateManager("wipe-1");
      getOrCreateSessionStateManager("wipe-2");
      const count = destroyAllSessionStateManagers();
      expect(count).toBe(2);
      expect(getAllSessionStateManagers().size).toBe(0);
    });
  });

  describe("edge cases", () => {
    test("start from non-INIT state returns false in strict mode", async () => {
      const m = getOrCreateSessionStateManager("edge-dup-start");
      await m.start();

      const result = await m.start("second attempt");
      expect(result).toBe(false);
      expect(m.state).toBe(SessionState.RUNNING);
    });

    test("从 INIT 状态 complete 返回 false", async () => {
      const m = getOrCreateSessionStateManager("edge-complete-init");
      await expect(m.complete()).resolves.toBe(false);
    });
  });
});
