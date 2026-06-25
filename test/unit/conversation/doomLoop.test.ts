/**
 * DoomLoop 三维度检测策略测试
 *
 * 验证:
 *   1. 连续相同工具+参数重复检测(原有策略)
 *   2. 序列重复检测(新增 - 捕获交替循环)
 *   3. 总轮次兜底(新增 - 防止长时间死循环)
 */

import { beforeEach, describe, expect, test } from "bun:test";
import {
  DEFAULT_DOOM_LOOP_THRESHOLD,
  DEFAULT_MAX_TOTAL_ROUNDS,
  DEFAULT_SEQUENCE_WINDOW_SIZE,
  createDoomLoopState,
  detectDoomLoop,
} from "@/conversation/guard/doomLoop";

describe("DoomLoop 三维度检测", () => {
  let state: ReturnType<typeof createDoomLoopState>;

  beforeEach(() => {
    state = createDoomLoopState();
  });

  describe("策略一:连续相同工具+参数重复", () => {
    test("低于阈值不触发", () => {
      for (let i = 0; i < DEFAULT_DOOM_LOOP_THRESHOLD - 1; i++) {
        const result = detectDoomLoop(state, "bash", { cmd: "ls" });
        expect(result.doomed).toBe(false);
      }
    });

    test("达到阈值触发", () => {
      // 先填满 threshold-1 次
      for (let i = 0; i < DEFAULT_DOOM_LOOP_THRESHOLD - 1; i++) {
        detectDoomLoop(state, "bash", { cmd: "ls" });
      }
      // 第 threshold 次触发
      const result = detectDoomLoop(state, "bash", { cmd: "ls" });
      expect(result.doomed).toBe(true);
      expect(result.reason).toContain("bash");
      expect(result.reason).toContain("连续调用");
    });

    test("中间换工具后重置", () => {
      for (let i = 0; i < 3; i++) {
        detectDoomLoop(state, "bash", { cmd: "ls" });
      }
      // 中间换工具
      const result = detectDoomLoop(state, "git", { cmd: "status" });
      expect(result.doomed).toBe(false);
    });

    test("参数变化后重置", () => {
      for (let i = 0; i < 3; i++) {
        detectDoomLoop(state, "bash", { cmd: "ls" });
      }
      // 参数不同，不触发
      const result = detectDoomLoop(state, "bash", { cmd: "pwd" });
      expect(result.doomed).toBe(false);
    });
  });

  describe("策略二:序列重复检测(交替循环)", () => {
    test("A→B→A→B 模式检测", () => {
      // 需要填满 2 倍窗口大小
      for (let i = 0; i < DEFAULT_SEQUENCE_WINDOW_SIZE * 2 - 1; i++) {
        detectDoomLoop(state, i % 2 === 0 ? "toolA" : "toolB", { data: i });
      }
      // 最后一次触发
      const finalIndex = DEFAULT_SEQUENCE_WINDOW_SIZE * 2 - 1;
      const result = detectDoomLoop(state, finalIndex % 2 === 0 ? "toolA" : "toolB", { data: 1 });
      expect(result.doomed).toBe(true);
      expect(result.reason).toContain("交替循环");
    });

    test("单工具循环不触发序列检测", () => {
      for (let i = 0; i < DEFAULT_SEQUENCE_WINDOW_SIZE * 2 - 1; i++) {
        detectDoomLoop(state, "sameTool", { data: i });
      }
      // 单工具不会触发序列检测；参数变化时也不会被连续重复策略击中
      const result = detectDoomLoop(state, "sameTool", { data: 999 });
      expect(result.doomed).toBe(false);
    });
  });

  describe("策略三:总轮次兜底", () => {
    test("达到最大轮次时触发", () => {
      // 使用不同的工具和参数避免被策略一或策略二捕获
      for (let i = 0; i < DEFAULT_MAX_TOTAL_ROUNDS - 1; i++) {
        const result = detectDoomLoop(state, `tool_${i}`, { round: i });
        expect(result.doomed).toBe(false);
      }
      // 第 lastRound 次
      const result = detectDoomLoop(state, "last_tool", { round: 999 });
      expect(result.doomed).toBe(true);
      expect(result.reason).toContain("总轮次");
    });

    test("自定义最大轮次", () => {
      for (let i = 0; i < 9; i++) {
        detectDoomLoop(state, `tool_${i}`, { round: i });
      }
      const result = detectDoomLoop(state, "tool_9", { round: 9 }, { maxTotalRounds: 10 });
      expect(result.doomed).toBe(true);
      expect(result.reason).toContain("总轮次");
    });

    test("总轮次比重复检测优先级高", () => {
      // 先积累不同工具，避免先被连续重复策略击中
      for (let i = 0; i < 4; i++) {
        detectDoomLoop(state, `prep_${i}`, { data: i }, { maxTotalRounds: 5 });
      }

      const result = detectDoomLoop(state, "fast_tool", { data: "same" }, { maxTotalRounds: 5 });
      expect(result.doomed).toBe(true);
      expect(result.reason).toContain("总轮次"); // 总轮次先触发，不需要达到重复阈值
    });
  });

  describe("createDoomLoopState", () => {
    test("初始状态正确", () => {
      const s = createDoomLoopState();
      expect(s.recentToolCalls).toEqual([]);
      expect(s.totalToolRounds).toBe(0);
    });
  });
});
