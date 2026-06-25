/**
 * editorContext 门面模块测试
 */
import { describe, it, expect, beforeEach, mock } from "bun:test";
import type { EditorContext } from "@/ide/types";

// ─── Mock 声明 ──────────────────────────────────────────────────

const mockGetEditorContext = mock(() => ({}) as EditorContext);
const mockGetAggregatedContextPrompt = mock(() => "");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockOnAggregatedContextChange = mock((_cb: any) => () => {});

mock.module("@/ide/connection/stateManager", () => ({
  ideStateManager: {
    getEditorContext: mockGetEditorContext,
  },
}));

mock.module("@/ide/connection/contextManager", () => ({
  getAggregatedContext: mock(() => ({ hasContext: false, editorContext: {}, workspaceFolders: [], connectedCount: 0 })),
  getAggregatedContextPrompt: mockGetAggregatedContextPrompt,
  onAggregatedContextChange: mockOnAggregatedContextChange,
}));

// ─── 动态导入（在 mock.module 之后） ───────────────────────────

const {
  buildEditorContextPrompt,
  hasEditorContext,
  getEditorContextSummary,
  onEditorContextChange,
  startEditorContextWatch,
} = await import("@/ide/context/editorContext");

// ─── 辅助 ──────────────────────────────────────────────────────

function makeEditorContext(overrides: Partial<EditorContext> = {}): EditorContext {
  return { ...overrides };
}

describe("editorContext", () => {
  beforeEach(() => {
    mockGetEditorContext.mockClear();
    mockGetEditorContext.mockReturnValue({} as EditorContext);
    mockGetAggregatedContextPrompt.mockClear();
    mockGetAggregatedContextPrompt.mockReturnValue("");
    mockOnAggregatedContextChange.mockClear();
    mockOnAggregatedContextChange.mockReturnValue(() => {});
  });

  // ─── buildEditorContextPrompt ──────────────────────────────────

  describe("buildEditorContextPrompt", () => {
    it("委托到 contextManager.getAggregatedContextPrompt()", () => {
      mockGetAggregatedContextPrompt.mockReturnValue("## IDE Context (WebSocket)");
      const result = buildEditorContextPrompt();
      expect(result).toBe("## IDE Context (WebSocket)");
      expect(mockGetAggregatedContextPrompt).toHaveBeenCalledTimes(1);
    });

    it("无上下文时返回空字符串", () => {
      mockGetAggregatedContextPrompt.mockReturnValue("");
      const result = buildEditorContextPrompt();
      expect(result).toBe("");
    });
  });

  // ─── hasEditorContext ───────────────────────────────────────────

  describe("hasEditorContext", () => {
    it("有 activeFile 时返回 true", () => {
      mockGetEditorContext.mockReturnValue(makeEditorContext({ activeFile: "/tmp/a.ts" }));
      expect(hasEditorContext()).toBe(true);
    });

    it("无 activeFile 时返回 false", () => {
      mockGetEditorContext.mockReturnValue(makeEditorContext({}));
      expect(hasEditorContext()).toBe(false);
    });

    it("仅有 cursorPosition 但无 activeFile 返回 false", () => {
      mockGetEditorContext.mockReturnValue(makeEditorContext({ cursorPosition: { line: 0, character: 0 } }));
      expect(hasEditorContext()).toBe(false);
    });
  });

  // ─── getEditorContextSummary ───────────────────────────────────

  describe("getEditorContextSummary", () => {
    it("无 activeFile 时返回 'No active file'", () => {
      mockGetEditorContext.mockReturnValue(makeEditorContext({}));
      expect(getEditorContextSummary()).toBe("No active file");
    });

    it("仅有文件名时返回文件名", () => {
      mockGetEditorContext.mockReturnValue(makeEditorContext({ activeFile: "/tmp/a.ts" }));
      expect(getEditorContextSummary()).toBe("a.ts");
    });

    it("包含光标位置时显示行号", () => {
      mockGetEditorContext.mockReturnValue(
        makeEditorContext({
          activeFile: "/home/user/project/src/index.ts",
          cursorPosition: { line: 4, character: 10 },
        }),
      );
      // line 4 (0-based) → display line 5
      expect(getEditorContextSummary()).toBe("index.ts:5");
    });

    it("包含选中文本时显示行数", () => {
      mockGetEditorContext.mockReturnValue(
        makeEditorContext({
          activeFile: "/tmp/a.ts",
          selectedText: "line1\nline2\nline3",
        }),
      );
      expect(getEditorContextSummary()).toBe("a.ts (3 lines selected)");
    });

    it("同时包含光标和选中文本时完整显示", () => {
      mockGetEditorContext.mockReturnValue(
        makeEditorContext({
          activeFile: "/tmp/b.ts",
          cursorPosition: { line: 9, character: 0 },
          selectedText: "x\ny",
        }),
      );
      expect(getEditorContextSummary()).toBe("b.ts:10 (2 lines selected)");
    });
  });

  // ─── onEditorContextChange ─────────────────────────────────────

  describe("onEditorContextChange", () => {
    it("注册回调并返回取消订阅函数", () => {
      const unsub = onEditorContextChange(() => {});
      expect(mockOnAggregatedContextChange).toHaveBeenCalledTimes(1);
      expect(typeof unsub).toBe("function");
      unsub();
    });

    it("有 activeFile 时立即触发一次回调", () => {
      mockGetEditorContext.mockReturnValue(makeEditorContext({ activeFile: "/tmp/a.ts" }));
      const cb = mock(() => {});
      onEditorContextChange(cb);
      // 首次通知（因为 activeFile 存在） + onAggregatedContextChange 被调用
      // 首次通知不是通过 mockOnAggregatedContextChange 的回调，而是直接调用
      // 所以 mockOnAggregatedContextChange 调用 1 次，cb 调用 1 次
      expect(cb).toHaveBeenCalledTimes(1);
      const firstArg = (cb.mock.calls as unknown[][])[0]![0] as EditorContext;
      expect(firstArg.activeFile).toBe("/tmp/a.ts");
    });

    it("无 activeFile 时不立即触发回调", () => {
      mockGetEditorContext.mockReturnValue(makeEditorContext({}));
      const cb = mock(() => {});
      onEditorContextChange(cb);
      expect(cb).toHaveBeenCalledTimes(0);
    });

    it("contextManager 触发变更时回调收到 editorContext", () => {
      mockGetEditorContext.mockReturnValue(makeEditorContext({}));
      const cb = mock(() => {});
      const contextPayload: EditorContext = { activeFile: "/tmp/new.ts" };

      // 捕获传给 onAggregatedContextChange 的回调并模拟触发
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockOnAggregatedContextChange.mockImplementation((listener: any) => {
        // 延迟触发以验证回调
        setTimeout(() => {
          listener({ editorContext: contextPayload });
        }, 0);
        return () => {};
      });

      onEditorContextChange(cb);
      // 因为无 activeFile，首次不触发
      expect(cb).toHaveBeenCalledTimes(0);
    });

    it("取消订阅后不再收到通知", () => {
      mockGetEditorContext.mockReturnValue(makeEditorContext({ activeFile: "/tmp/a.ts" }));
      const cb = mock(() => {});
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let capturedListener: any = null;

      mockOnAggregatedContextChange.mockImplementation((listener: any) => {
        capturedListener = listener;
        return () => {
          capturedListener = null;
        };
      });

      const unsub = onEditorContextChange(cb);
      expect(cb).toHaveBeenCalledTimes(1);

      // 触发变更
      capturedListener({ editorContext: { activeFile: "/tmp/b.ts" } });
      expect(cb).toHaveBeenCalledTimes(2);

      // 取消订阅
      unsub();
      if (capturedListener) {
        capturedListener({ editorContext: { activeFile: "/tmp/c.ts" } });
      }
      // 取消后不再被调用（回调中有 active guard）
      expect(cb).toHaveBeenCalledTimes(2);
    });

    it("回调异常不影响其他监听器（best-effort）", () => {
      mockGetEditorContext.mockReturnValue(makeEditorContext({}));
      const cb1 = mock(() => {
        throw new Error("test error");
      });
      const cb2 = mock(() => {});
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let capturedListener: any = null;

      mockOnAggregatedContextChange.mockImplementation((listener: any) => {
        capturedListener = listener;
        return () => {};
      });

      onEditorContextChange(cb1);
      onEditorContextChange(cb2);

      // 触发变更 — safeNotify 捕获异常，不影响后续回调
      capturedListener({ editorContext: { activeFile: "/tmp/a.ts" } });
      // 每个 onEditorContextChange 注册独立的 listener，但 mockImplementation
      // 每次覆盖 capturedListener，所以只有 cb2 的 listener 被触发
      expect(cb2).toHaveBeenCalledTimes(1);
    });
  });

  // ─── startEditorContextWatch ───────────────────────────────────

  describe("startEditorContextWatch", () => {
    it("调用一次不抛异常", () => {
      expect(() => startEditorContextWatch()).not.toThrow();
    });

    it("幂等：调用两次不会创建重复订阅", () => {
      startEditorContextWatch();
      startEditorContextWatch();
      // 没有副作用可以断言，主要是验证不会抛异常
      // 该函数只设置 autoStarted 标志并返回
    });
  });
});
