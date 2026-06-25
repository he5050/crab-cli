/**
 * Esc 语义集中表守卫测试 [P2-20]
 *
 * 覆盖 EscAction 的每个 kind + 优先级顺序。
 */
import { describe, expect, test } from "bun:test";
import { type EscContext, defaultEscContext, resolveEscape, resolveHistoryDirection } from "@/ui/escBehavior";

function ctx(over: Partial<EscContext> = {}): EscContext {
  return { ...defaultEscContext(), ...over };
}

describe("escBehavior.resolveEscape", () => {
  test("none — empty ctx", () => {
    const action = resolveEscape(ctx());
    expect(action.kind).toBe("none");
  });

  test("closeTopDialog — openDialog=true", () => {
    const action = resolveEscape(ctx({ openDialog: true }));
    expect(action.kind).toBe("closeTopDialog");
  });

  test("closeTopDialog — modalStackDepth>0", () => {
    const action = resolveEscape(ctx({ modalStackDepth: 2 }));
    expect(action.kind).toBe("closeTopDialog");
  });

  test("popInputMode — lastInputMode=freeInput, 无对话框", () => {
    const action = resolveEscape(ctx({ lastInputMode: "freeInput" }));
    expect(action.kind).toBe("popInputMode");
    if (action.kind === "popInputMode") {
      expect(action.mode).toBe("freeInput");
    }
  });

  test("popInputMode — lastInputMode=screenSubView, 无对话框", () => {
    const action = resolveEscape(ctx({ lastInputMode: "screenSubView" }));
    expect(action.kind).toBe("popInputMode");
    if (action.kind === "popInputMode") {
      expect(action.mode).toBe("screenSubView");
    }
  });

  test("rejectPendingPermission — pendingPermission=true", () => {
    const action = resolveEscape(ctx({ pendingPermission: true }));
    expect(action.kind).toBe("rejectPendingPermission");
  });

  test("historyPrev — lastInputMode=历史, 无其他触发", () => {
    const action = resolveEscape(ctx({ lastInputMode: "history" }));
    expect(action.kind).toBe("historyPrev");
  });
});

describe("escBehavior.resolveHistoryDirection", () => {
  test("上 → historyPrev", () => {
    expect(resolveHistoryDirection("up").kind).toBe("historyPrev");
  });
  test("下 → historyNext", () => {
    expect(resolveHistoryDirection("down").kind).toBe("historyNext");
  });
  test("未定义 → historyPrev (默认)", () => {
    expect(resolveHistoryDirection(undefined).kind).toBe("historyPrev");
  });
});

describe("escBehavior 优先级 (priority order)", () => {
  test("pendingPermission > openDialog", () => {
    const action = resolveEscape(ctx({ openDialog: true, pendingPermission: true }));
    expect(action.kind).toBe("rejectPendingPermission");
  });

  test("openDialog > inputMode", () => {
    const action = resolveEscape(ctx({ lastInputMode: "freeInput", openDialog: true }));
    expect(action.kind).toBe("closeTopDialog");
  });

  test("inputMode > 历史", () => {
    const action = resolveEscape(ctx({ lastInputMode: "selectArg" }));
    expect(action.kind).toBe("popInputMode");
  });
});
