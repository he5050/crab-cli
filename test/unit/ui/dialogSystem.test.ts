/**
 * 对话框系统测试。
 *
 * 测试目标:
 *   - 验证对话框(dialog)系统在多种类型(确认、输入、选择等)下的行为
 *
 * 测试用例:
 *   - 关键源码结构稳定
 *   - 对话框组件导出与无未使用符号
 */
import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(import.meta.dir, "../../..");

describe("Phase 20 Dialog System", () => {
  test("DialogSelect exposes opencode navigation keys", () => {
    const source = fs.readFileSync(path.join(ROOT, "src/ui/components/dialogSelect.tsx"), "utf8");

    expect(source).toContain('event.name === "up" || (event.ctrl && event.name === "p")');
    expect(source).toContain('event.name === "down" || (event.ctrl && event.name === "n")');
    expect(source).toContain('event.name === "pageup"');
    expect(source).toContain('event.name === "pagedown"');
    expect(source).toContain('event.name === "home"');
    expect(source).toContain('event.name === "end"');
    expect(source).toContain("props.onConfirm()");
    expect(source).toContain("props.onCancel()");
  });

  test("AgentPicker is unified through DialogSelect", () => {
    const source = fs.readFileSync(path.join(ROOT, "src/ui/components/agentPicker.tsx"), "utf8");

    expect(source).toContain("DialogSelect");
    expect(source).toContain("SelectOption<AgentInfo>");
    expect(source).toContain('placeholder="搜索 agent / mode / model..."');
    expect(source).not.toContain("useKeyboard");
    expect(source).not.toContain("borderStyle");
  });

  test("Recovery dismiss is non-destructive", () => {
    const source = fs.readFileSync(path.join(ROOT, "src/ui/components/dialogRoot.tsx"), "utf8");

    expect(source).toContain("onDismiss={() => {");
    expect(source).toContain("setShowRecovery(false);");
    expect(source).not.toContain("for (const s of recoverableSessions())");
    expect(source).not.toContain("clearAgentState(s.sessionId)");
  });
});
