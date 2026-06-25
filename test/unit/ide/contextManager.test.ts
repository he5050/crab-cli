/**
 * IDE 上下文管理器测试
 */
import { describe, it, expect, beforeEach, mock } from "bun:test";
import type { IDEConnectionState } from "@/ide/connection/stateManager";

// Mock stateManager before importing contextManager
const defaultState: IDEConnectionState = {
  clientCount: 0,
  editorContext: {},
  workspaceFolders: [],
  clients: [],
  connected: false,
  serverPort: 0,
  serverStatus: "disconnected",
};

const mockGetState = mock(() => ({ ...defaultState }));
const mockGetEditorContext = mock(() => ({}));
const mockOnContextChange = mock(() => () => {});

mock.module("@/ide/connection/stateManager", () => ({
  ideStateManager: {
    getState: mockGetState,
    getEditorContext: mockGetEditorContext,
    onContextChange: mockOnContextChange,
  },
}));

const { getAggregatedContext, getAggregatedContextPrompt } = await import("@/ide/connection/contextManager");

function makeState(overrides: Partial<IDEConnectionState> = {}): IDEConnectionState {
  return { ...defaultState, ...overrides };
}

describe("contextManager", () => {
  beforeEach(() => {
    mockGetState.mockClear();
    mockGetState.mockReturnValue({ ...defaultState });
    mockGetEditorContext.mockClear();
    mockGetEditorContext.mockReturnValue({});
    mockOnContextChange.mockClear();
    mockOnContextChange.mockReturnValue(() => {});
  });

  describe("getAggregatedContext", () => {
    it("无上下文时 hasContext=false", () => {
      const ctx = getAggregatedContext();
      expect(ctx.hasContext).toBe(false);
      expect(ctx.connectedCount).toBe(0);
      expect(ctx.workspaceFolders).toEqual([]);
      expect(ctx.editorContext).toEqual({});
    });

    it("有上下文时 hasContext=true", () => {
      mockGetState.mockReturnValue(
        makeState({
          clientCount: 2,
          editorContext: {
            activeFile: "/tmp/a.ts",
            cursorPosition: { line: 5, character: 3 },
            selectedText: "hello",
            workspaceFolder: "/tmp",
          },
          workspaceFolders: ["/tmp", "/home"],
        }),
      );
      const ctx = getAggregatedContext();
      expect(ctx.hasContext).toBe(true);
      expect(ctx.connectedCount).toBe(2);
      expect(ctx.workspaceFolders).toEqual(["/tmp", "/home"]);
      expect(ctx.editorContext.activeFile).toBe("/tmp/a.ts");
    });

    it("activeFile 为空时 hasContext=false", () => {
      mockGetState.mockReturnValue(
        makeState({
          clientCount: 1,
          editorContext: { cursorPosition: { line: 0, character: 0 } },
        }),
      );
      const ctx = getAggregatedContext();
      expect(ctx.hasContext).toBe(false);
    });
  });

  describe("getAggregatedContextPrompt", () => {
    it("无上下文返回空字符串", () => {
      const prompt = getAggregatedContextPrompt();
      expect(prompt).toBe("");
    });

    it("有上下文返回格式化字符串", () => {
      mockGetState.mockReturnValue(
        makeState({
          clientCount: 1,
          editorContext: {
            activeFile: "/tmp/a.ts",
            cursorPosition: { line: 4, character: 10 },
            selectedText: "line1\nline2",
            workspaceFolder: "/tmp",
          },
          workspaceFolders: ["/tmp"],
        }),
      );
      const prompt = getAggregatedContextPrompt();
      expect(prompt).toContain("## IDE Context (WebSocket)");
      expect(prompt).toContain("Connected IDEs: 1");
      expect(prompt).toContain("Workspaces: /tmp");
      expect(prompt).toContain("Active file: /tmp/a.ts");
      // cursorPosition line 4 → display line 5, character 10 → display column 11
      expect(prompt).toContain("Cursor: line 5, column 11");
      expect(prompt).toContain("Selected text (2 lines):");
      expect(prompt).toContain("```");
      expect(prompt).toContain("line1\nline2");
    });

    it("选中代码 <= 30 行不截断", () => {
      const lines = Array.from({ length: 25 }, (_, i) => `line${i}`);
      mockGetState.mockReturnValue(
        makeState({
          clientCount: 1,
          editorContext: {
            activeFile: "/tmp/a.ts",
            selectedText: lines.join("\n"),
          },
        }),
      );
      const prompt = getAggregatedContextPrompt();
      expect(prompt).toContain("Selected text (25 lines):");
      expect(prompt).toContain("line0");
      expect(prompt).toContain("line24");
      expect(prompt).not.toContain("omitted");
    });

    it("选中代码 > 30 行截断", () => {
      const lines = Array.from({ length: 40 }, (_, i) => `line${i}`);
      mockGetState.mockReturnValue(
        makeState({
          clientCount: 1,
          editorContext: {
            activeFile: "/tmp/a.ts",
            selectedText: lines.join("\n"),
          },
        }),
      );
      const prompt = getAggregatedContextPrompt();
      expect(prompt).toContain("Selected text (40 lines, truncated):");
      // 前 5 行
      expect(prompt).toContain("line0");
      expect(prompt).toContain("line4");
      // 省略提示
      expect(prompt).toContain("32 lines omitted");
      // 后 3 行
      expect(prompt).toContain("line37");
      expect(prompt).toContain("line39");
      // 中间行不出现
      expect(prompt).not.toContain("line10");
    });

    it("无 workspaceFolders 不输出 Workspaces 行", () => {
      mockGetState.mockReturnValue(
        makeState({
          clientCount: 1,
          editorContext: { activeFile: "/tmp/a.ts" },
        }),
      );
      const prompt = getAggregatedContextPrompt();
      expect(prompt).not.toContain("Workspaces:");
    });
  });
});
