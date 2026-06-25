/**
 * 模式状态管理测试 — 验证模式切换逻辑。
 *
 * 测试用例:
 *   - 初始状态为 chat
 *   - 切换到 plan 模式
 *   - team 模式缺少对应 agent 时回退
 *   - YOLO 叠加切换
 *   - 模式切换触发 Agent 切换
 *   - 重置模式状态
 */
import { beforeEach, describe, expect, test } from "bun:test";
import {
  getCurrentMode,
  getEffectiveMode,
  getYoloOverlay,
  resetModeState,
  switchMode,
} from "@/agent/runtime/modeState";
import { _resetAll, getActiveAgentName, initBuiltinAgents } from "@/agent/core/manager";

describe("模式状态管理", () => {
  beforeEach(() => {
    _resetAll();
    initBuiltinAgents();
    resetModeState();
  });

  test("初始状态为 chat", () => {
    expect(getCurrentMode()).toBe("chat");
    expect(getYoloOverlay()).toBe(false);
    expect(getEffectiveMode()).toBe("chat");
  });

  test("切换到 plan 模式", () => {
    switchMode("plan");
    expect(getCurrentMode()).toBe("plan");
    expect(getActiveAgentName()).toBe("plan");
  });

  test("team 模式缺少对应 agent 时回退到 chat", () => {
    switchMode("team");
    expect(getCurrentMode()).toBe("chat");
    expect(getActiveAgentName()).toBe("general");
  });

  test("切换到 chat 模式", () => {
    switchMode("plan");
    expect(getCurrentMode()).toBe("plan");
    switchMode("chat");
    expect(getCurrentMode()).toBe("chat");
    expect(getActiveAgentName()).toBe("general");
  });

  test("YOLO 叠加切换(toggle)", () => {
    expect(getYoloOverlay()).toBe(false);
    switchMode("yolo");
    expect(getYoloOverlay()).toBe(true);
    expect(getEffectiveMode()).toBe("yolo");
    // 再次切换关闭 YOLO
    switchMode("yolo");
    expect(getYoloOverlay()).toBe(false);
  });

  test("切换到非 YOLO 模式时清除 YOLO 叠加", () => {
    switchMode("yolo"); // 开启 YOLO
    expect(getYoloOverlay()).toBe(true);
    switchMode("plan"); // 切换到 plan
    expect(getYoloOverlay()).toBe(false);
    expect(getCurrentMode()).toBe("plan");
  });

  test("重置模式状态", () => {
    switchMode("plan");
    switchMode("yolo"); // YOLO 叠加
    resetModeState();
    expect(getCurrentMode()).toBe("chat");
    expect(getYoloOverlay()).toBe(false);
    expect(getEffectiveMode()).toBe("chat");
  });
});
