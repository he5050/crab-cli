/**
 * SessionOrchestrator 纯函数逻辑测试
 *
 * 由于 orchestrator.ts 依赖真实的 conversationHandler 和 agentState 模块，
 * 这里测试其内部纯函数逻辑(选项合并、abort 控制器管理)。
 *
 * 覆盖 P2-4 重构:
 *   1. 字段合并优先级(savedState > overrides)
 *   2. 必填字段默认行为
 *   3. abort 控制器状态机
 *   4. startRequest/endRequest 切换
 */

import { describe, expect, it } from "bun:test";

/** 复制 RuntimeOverrides 类型用于测试 */
interface RuntimeOverrides {
  systemPrompt?: string;
  maxToolRounds?: number;
  allowedTools?: string[];
  providerId?: string;
  modelId?: string;
  temperature?: number;
  topP?: number;
}

/** 复刻 orchestrator 的字段合并逻辑(避免依赖真实模块) */
function mergeOptions(
  savedState: Partial<RuntimeOverrides> | null,
  overrides: RuntimeOverrides,
  sessionId?: string,
  initialMessages?: unknown[],
  mode?: string,
): {
  sessionId?: string;
  initialMessages: unknown[];
  systemPrompt?: string;
  maxToolRounds?: number;
  allowedTools?: string[];
  mode?: string;
  providerId?: string;
  modelId?: string;
  temperature?: number;
  topP?: number;
} {
  return {
    allowedTools: savedState?.allowedTools ?? overrides.allowedTools,
    initialMessages: initialMessages ?? [],
    maxToolRounds: overrides.maxToolRounds,
    mode,
    modelId: savedState?.modelId ?? overrides.modelId,
    providerId: savedState?.providerId ?? overrides.providerId,
    sessionId,
    systemPrompt: savedState?.systemPrompt ?? overrides.systemPrompt,
    temperature: savedState?.temperature ?? overrides.temperature,
    topP: savedState?.topP ?? overrides.topP,
  };
}

/**
 * 复刻 abort 控制器状态机逻辑
 */
class AbortControllerBox {
  active: AbortController | null = null;
  start(): AbortController {
    if (this.active) {
      this.active.abort();
    }
    const ctrl = new AbortController();
    this.active = ctrl;
    return ctrl;
  }
  end(): void {
    this.active = null;
  }
  dispose(): void {
    if (this.active) {
      this.active.abort();
    }
    this.active = null;
  }
}

describe("SessionOrchestrator 字段合并逻辑 (P2-4)", () => {
  it("无 savedState 时使用 overrides", () => {
    const result = mergeOptions(null, {
      allowedTools: ["t1"],
      modelId: "m1",
      providerId: "p1",
      systemPrompt: "override-prompt",
      temperature: 0.5,
      topP: 0.9,
    });
    expect(result.systemPrompt).toBe("override-prompt");
    expect(result.allowedTools).toEqual(["t1"]);
    expect(result.providerId).toBe("p1");
    expect(result.modelId).toBe("m1");
    expect(result.temperature).toBe(0.5);
    expect(result.topP).toBe(0.9);
  });

  it("savedState 字段优先于 overrides", () => {
    const result = mergeOptions(
      {
        allowedTools: ["saved-tool"],
        modelId: "saved-model",
        providerId: "saved-provider",
        systemPrompt: "saved-prompt",
        temperature: 0.1,
        topP: 0.2,
      },
      {
        allowedTools: ["override-tool"],
        modelId: "override-model",
        providerId: "override-provider",
        systemPrompt: "override-prompt",
        temperature: 0.9,
        topP: 0.8,
      },
    );
    expect(result.systemPrompt).toBe("saved-prompt");
    expect(result.allowedTools).toEqual(["saved-tool"]);
    expect(result.providerId).toBe("saved-provider");
    expect(result.modelId).toBe("saved-model");
    expect(result.temperature).toBe(0.1);
    expect(result.topP).toBe(0.2);
  });

  it("部分 savedState 字段 — 缺失字段回退到 overrides", () => {
    const result = mergeOptions(
      { providerId: "saved-p", systemPrompt: "saved" },
      { modelId: "override-m", temperature: 0.5 },
    );
    expect(result.systemPrompt).toBe("saved");
    expect(result.providerId).toBe("saved-p");
    expect(result.modelId).toBe("override-m");
    expect(result.temperature).toBe(0.5);
  });

  it("sessionId 透传", () => {
    const result = mergeOptions(null, {}, "sess-123");
    expect(result.sessionId).toBe("sess-123");
  });

  it("initialMessages 默认空数组", () => {
    const result = mergeOptions(null, {});
    expect(result.initialMessages).toEqual([]);
  });

  it("initialMessages 透传", () => {
    const msgs = [{ content: "Hi", role: "user" }];
    const result = mergeOptions(null, {}, undefined, msgs);
    expect(result.initialMessages).toEqual(msgs);
  });

  it("mode 透传", () => {
    const result = mergeOptions(null, {}, undefined, undefined, "code");
    expect(result.mode).toBe("code");
  });

  it("maxToolRounds 仅来自 overrides(不被 savedState 覆盖)", () => {
    // 按设计:maxToolRounds 是配置项，不应由保存的旧状态覆盖
    const result = mergeOptions({ systemPrompt: "saved" } as any, { maxToolRounds: 20 });
    expect(result.maxToolRounds).toBe(20);
  });
});

describe("SessionOrchestrator abort 控制器生命周期 (P2-4)", () => {
  let box: AbortControllerBox;

  beforeEach_Abort();
  function beforeEach_Abort() {
    // Bun:test 风格的 setup
  }

  it("初始 active 为 null", () => {
    box = new AbortControllerBox();
    expect(box.active).toBeNull();
  });

  it("start() 创建 AbortController", () => {
    box = new AbortControllerBox();
    const ctrl = box.start();
    expect(ctrl).toBeInstanceOf(AbortController);
    expect(box.active).toBe(ctrl);
    expect(ctrl.signal.aborted).toBe(false);
  });

  it("再次 start() 中止旧的控制器", () => {
    box = new AbortControllerBox();
    const ctrl1 = box.start();
    const ctrl2 = box.start();
    expect(ctrl1.signal.aborted).toBe(true);
    expect(ctrl2.signal.aborted).toBe(false);
    expect(box.active).toBe(ctrl2);
  });

  it("end() 清理 active 但不中止", () => {
    box = new AbortControllerBox();
    const ctrl = box.start();
    box.end();
    expect(box.active).toBeNull();
    expect(ctrl.signal.aborted).toBe(false);
  });

  it("dispose() 中止 + 清理", () => {
    box = new AbortControllerBox();
    const ctrl = box.start();
    box.dispose();
    expect(box.active).toBeNull();
    expect(ctrl.signal.aborted).toBe(true);
  });

  it("dispose() 在无 active 时幂等", () => {
    box = new AbortControllerBox();
    expect(() => box.dispose()).not.toThrow();
    expect(() => box.dispose()).not.toThrow();
  });

  it("连续 start/end 周期正常工作", () => {
    box = new AbortControllerBox();
    for (let i = 0; i < 5; i++) {
      const ctrl = box.start();
      expect(ctrl.signal.aborted).toBe(false);
      box.end();
      expect(box.active).toBeNull();
    }
  });
});
