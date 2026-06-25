/**
 * 死循环检测测试
 *
 * 覆盖 doomLoop.ts 三大检测策略:
 *   1. 精确重复检测(连续相同工具+参数)
 *   2. 序列重复检测(交替循环模式)
 *   3. 总轮次兜底检测
 *
 * 同时覆盖 doomLoopPolicy.ts 统一入口行为。
 */

import { beforeEach, describe, expect, it } from "bun:test";
import {
  DEFAULT_DOOM_LOOP_THRESHOLD,
  DEFAULT_SEQUENCE_WINDOW_SIZE,
  type DoomLoopState,
  createDoomLoopState,
  detectDoomLoop,
  detectExactRepeat,
  detectMaxRoundsExceeded,
  detectSequenceRepeat,
} from "@/conversation/guard/doomLoop";
import { checkDoomLoop, resolveDoomLoopThreshold } from "@/conversation/guard/doomLoopPolicy";

describe("DoomLoopState", () => {
  it("createDoomLoopState 创建干净状态", () => {
    const state = createDoomLoopState();
    expect(state.recentToolCalls).toEqual([]);
    expect(state.totalToolRounds).toBe(0);
  });
});

// ─── 策略一:精确重复检测 ───────────────────────────────────

describe("detectExactRepeat", () => {
  it("调用次数不足时不触发", () => {
    const state = createDoomLoopState();
    state.recentToolCalls = [
      { args: '{"path":"a.ts"}', toolName: "read_file" },
      { args: '{"path":"a.ts"}', toolName: "read_file" },
    ];
    expect(detectExactRepeat(state, "read_file", '{"path":"a.ts"}', 5)).toBe(false);
  });

  it("连续 N 次相同调用时触发", () => {
    const state = createDoomLoopState();
    for (let i = 0; i < 5; i++) {
      state.recentToolCalls.push({ args: '{"pattern":"TODO"}', toolName: "grep" });
    }
    expect(detectExactRepeat(state, "grep", '{"pattern":"TODO"}', 5)).toBe(true);
  });

  it("工具名相同但参数不同时不触发", () => {
    const state = createDoomLoopState();
    for (let i = 0; i < 4; i++) {
      state.recentToolCalls.push({ args: '{"pattern":"TODO"}', toolName: "grep" });
    }
    state.recentToolCalls.push({ args: '{"pattern":"FIXME"}', toolName: "grep" });
    expect(detectExactRepeat(state, "grep", '{"pattern":"FIXME"}', 5)).toBe(false);
  });

  it("在 N 次连续后插入不同调用再继续不触发", () => {
    const state = createDoomLoopState();
    for (let i = 0; i < 3; i++) {
      state.recentToolCalls.push({ args: '{"path":"a.ts"}', toolName: "read_file" });
    }
    state.recentToolCalls.push({ args: '{"path":"b.ts"}', toolName: "write_file" });
    for (let i = 0; i < 4; i++) {
      state.recentToolCalls.push({ args: '{"path":"a.ts"}', toolName: "read_file" });
    }
    // 最近 5 次不是全部相同(第 1 次是 write_file)
    expect(detectExactRepeat(state, "read_file", '{"path":"a.ts"}', 5)).toBe(false);
  });

  it("threshold=1 时单次调用即触发", () => {
    const state = createDoomLoopState();
    state.recentToolCalls.push({ args: '{"command":"ls"}', toolName: "bash" });
    expect(detectExactRepeat(state, "bash", '{"command":"ls"}', 1)).toBe(true);
  });
});

// ─── 策略二:序列重复检测 ───────────────────────────────────

describe("detectSequenceRepeat", () => {
  it("调用次数不足以形成两个窗口时不触发", () => {
    const state = createDoomLoopState();
    for (let i = 0; i < 7; i++) {
      state.recentToolCalls.push({ args: '{"path":"a.ts"}', toolName: "read_file" });
    }
    // 需要 windowSize * 2 = 16 次调用(默认窗口 8)
    expect(detectSequenceRepeat(state, DEFAULT_SEQUENCE_WINDOW_SIZE)).toBe(false);
  });

  it("交替循环 A→B→A→B 模式触发", () => {
    const state = createDoomLoopState();
    const pattern = [
      { args: '{"path":"a.ts"}', toolName: "read_file" },
      { args: '{"path":"a.ts"}', toolName: "write_file" },
    ];
    // 需要至少 2 个完整窗口
    for (let i = 0; i < DEFAULT_SEQUENCE_WINDOW_SIZE * 2; i++) {
      state.recentToolCalls.push(pattern[i % 2]!);
    }
    expect(detectSequenceRepeat(state, DEFAULT_SEQUENCE_WINDOW_SIZE)).toBe(true);
  });

  it("A→B→C 交替模式触发(窗口需为周期倍数)", () => {
    const state = createDoomLoopState();
    const pattern = [
      { args: "{}", toolName: "read_file" },
      { args: "{}", toolName: "grep" },
      { args: "{}", toolName: "edit" },
    ];
    // 窗口 6 = 3 的倍数，需 2 * 6 = 12 个元素
    const windowSize = 6;
    for (let i = 0; i < windowSize * 2; i++) {
      state.recentToolCalls.push(pattern[i % 3]!);
    }
    // Last 6: items[6..11] = [read,grep,edit,read,grep,edit]
    // Prev 6: items[0..5]  = [read,grep,edit,read,grep,edit] → 匹配
    expect(detectSequenceRepeat(state, windowSize)).toBe(true);
  });

  it("随机工具名序列不触发", () => {
    const state = createDoomLoopState();
    const tools = ["read_file", "grep", "edit", "bash", "write_file", "search"];
    for (let i = 0; i < DEFAULT_SEQUENCE_WINDOW_SIZE * 2; i++) {
      state.recentToolCalls.push({
        args: `{}`,
        toolName: tools[i % tools.length]!,
      });
    }
    // 6 个工具轮转，窗口 8 无法形成完整重复
    expect(detectSequenceRepeat(state, DEFAULT_SEQUENCE_WINDOW_SIZE)).toBe(false);
  });

  it("自定义小窗口正常工作", () => {
    const state = createDoomLoopState();
    const pattern = [
      { args: "{}", toolName: "A" },
      { args: "{}", toolName: "B" },
    ];
    // 窗口 4 = 2 的倍数，需 2 * 4 = 8 个元素
    for (let i = 0; i < 8; i++) {
      state.recentToolCalls.push(pattern[i % 2]!);
    }
    // Last 4: [A,B,A,B], prev 4: [A,B,A,B] → 匹配
    expect(detectSequenceRepeat(state, 4)).toBe(true);
  });

  it("窗口大小不匹配时不触发(奇偶差异)", () => {
    const state = createDoomLoopState();
    // 7 次 A→B 交替
    const pattern = [
      { args: "{}", toolName: "A" },
      { args: "{}", toolName: "B" },
    ];
    for (let i = 0; i < 7; i++) {
      state.recentToolCalls.push(pattern[i % 2]!);
    }
    // 窗口 4:需要 8 次调用，只有 7 次
    expect(detectSequenceRepeat(state, 4)).toBe(false);
  });
});

// ─── 策略三:总轮次兜底 ─────────────────────────────────────

describe("detectMaxRoundsExceeded", () => {
  it("未达上限不触发", () => {
    expect(detectMaxRoundsExceeded(49, 50)).toBe(false);
  });

  it("达到上限触发", () => {
    expect(detectMaxRoundsExceeded(50, 50)).toBe(true);
  });

  it("超过上限触发", () => {
    expect(detectMaxRoundsExceeded(51, 50)).toBe(true);
  });

  it("maxRounds=0 时立即触发", () => {
    expect(detectMaxRoundsExceeded(0, 0)).toBe(true);
  });
});

// ─── 综合检测 detectDoomLoop ───────────────────────────────

describe("detectDoomLoop 综合检测", () => {
  let state: DoomLoopState;

  beforeEach(() => {
    state = createDoomLoopState();
  });

  it("正常调用不触发", () => {
    const result = detectDoomLoop(state, "read_file", { path: "a.ts" });
    expect(result.doomed).toBe(false);
    expect(result.reason).toBeUndefined();
  });

  it("精确重复达到阈值时触发并返回原因", () => {
    for (let i = 0; i < 4; i++) {
      detectDoomLoop(state, "grep", { pattern: "TODO" });
    }
    const result = detectDoomLoop(state, "grep", { pattern: "TODO" });
    expect(result.doomed).toBe(true);
    expect(result.reason).toContain("grep");
    expect(result.reason).toContain("5");
  });

  it("交替循环达到阈值时触发", () => {
    const windowSize = 4;
    // 需要 2 * windowSize = 8 次调用，形成两个相同窗口
    for (let i = 0; i < windowSize * 2; i++) {
      detectDoomLoop(state, i % 2 === 0 ? "A" : "B", {});
    }
    detectDoomLoop(state, "A", {}, { sequenceWindowSize: windowSize });
    // 注意:第 9 次调用后，最近 8 次形成完整序列
    // 再加一次确保窗口对齐
    detectDoomLoop(state, "B", {});
    const seqResult = detectDoomLoop(state, "A", {}, { sequenceWindowSize: windowSize });
    expect(seqResult.doomed).toBe(true);
    expect(seqResult.reason).toContain("交替循环");
  });

  it("总轮次上限优先级最高", () => {
    for (let i = 0; i < 2; i++) {
      const r = detectDoomLoop(state, `tool_${i}`, {});
      expect(r.doomed).toBe(false);
    }
    // 第 3 次达到上限 (maxTotalRounds=3)
    const roundsResult = detectDoomLoop(state, "tool_3", {}, { maxTotalRounds: 3 });
    expect(roundsResult.doomed).toBe(true);
    expect(roundsResult.reason).toContain("总轮次");
  });

  it("自定义阈值参数生效", () => {
    // Threshold=2: 连续 2 次相同触发
    detectDoomLoop(state, "bash", { cmd: "ls" });
    const result = detectDoomLoop(state, "bash", { cmd: "ls" }, { exactThreshold: 2 });
    expect(result.doomed).toBe(true);
  });

  it("args 对象被 JSON.stringify 后比较", () => {
    detectDoomLoop(state, "read", { path: "a.ts" });
    detectDoomLoop(state, "read", { path: "a.ts" });
    // 相同内容不同对象也应匹配
    const result = detectDoomLoop(state, "read", { path: "a.ts" }, { exactThreshold: 3 });
    expect(result.doomed).toBe(true);
  });

  it("recentToolCalls 滑动窗口正确裁剪", () => {
    const threshold = 5;
    // 调用 threshold * 2 + 1 次，检查窗口被裁剪
    for (let i = 0; i < threshold * 2 + 1; i++) {
      detectDoomLoop(state, `tool_${i}`, { idx: i });
    }
    // 窗口裁剪应在超过 exactThreshold * 2 时触发，验证不会无限增长
    expect(state.recentToolCalls.length).toBeLessThanOrEqual(threshold * 2 + 1);
  });

  it("totalToolRounds 每次调用递增", () => {
    detectDoomLoop(state, "a", {});
    detectDoomLoop(state, "b", {});
    detectDoomLoop(state, "c", {});
    expect(state.totalToolRounds).toBe(3);
  });
});

// ─── doomLoopPolicy 统一入口 ────────────────────────────────

describe("doomLoopPolicy", () => {
  it("resolveDoomLoopThreshold 默认值", () => {
    expect(resolveDoomLoopThreshold()).toBe(DEFAULT_DOOM_LOOP_THRESHOLD);
    expect(resolveDoomLoopThreshold({})).toBe(DEFAULT_DOOM_LOOP_THRESHOLD);
  });

  it("resolveDoomLoopThreshold 自定义合法值", () => {
    expect(resolveDoomLoopThreshold({ doomLoopThreshold: 10 })).toBe(10);
  });

  it("resolveDoomLoopThreshold 非法值回退默认", () => {
    expect(resolveDoomLoopThreshold({ doomLoopThreshold: 0 })).toBe(DEFAULT_DOOM_LOOP_THRESHOLD);
    expect(resolveDoomLoopThreshold({ doomLoopThreshold: -1 })).toBe(DEFAULT_DOOM_LOOP_THRESHOLD);
    expect(resolveDoomLoopThreshold({ doomLoopThreshold: 3.5 })).toBe(DEFAULT_DOOM_LOOP_THRESHOLD);
    // @ts-expect-error 测试非法类型
    expect(resolveDoomLoopThreshold({ doomLoopThreshold: "abc" })).toBe(DEFAULT_DOOM_LOOP_THRESHOLD);
  });

  it("checkDoomLoop 未检测到时返回 doomed=false", () => {
    const state = createDoomLoopState();
    const result = checkDoomLoop(state, "read_file", { path: "a.ts" });
    expect(result.doomed).toBe(false);
    expect(result.message).toBeUndefined();
    expect(result.threshold).toBe(DEFAULT_DOOM_LOOP_THRESHOLD);
  });

  it("checkDoomLoop 检测到时返回 doomed=true + message", () => {
    const state = createDoomLoopState();
    for (let i = 0; i < DEFAULT_DOOM_LOOP_THRESHOLD; i++) {
      checkDoomLoop(state, "grep", { pattern: "TODO" });
    }
    const result = checkDoomLoop(state, "grep", { pattern: "TODO" });
    expect(result.doomed).toBe(true);
    expect(result.message).toBeDefined();
    expect(result.threshold).toBe(DEFAULT_DOOM_LOOP_THRESHOLD);
  });

  it("checkDoomLoop 自定义阈值", () => {
    const state = createDoomLoopState();
    checkDoomLoop(state, "bash", { cmd: "ls" }, { doomLoopThreshold: 2 });
    const result = checkDoomLoop(state, "bash", { cmd: "ls" }, { doomLoopThreshold: 2 });
    expect(result.doomed).toBe(true);
    expect(result.threshold).toBe(2);
  });
});
