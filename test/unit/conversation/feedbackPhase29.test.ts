/**
 * [测试目标] Phase 29 Feedback 对齐。
 *
 * 测试目标:
 *   - 验证 statusFeedback 组件的反馈色调契约覆盖 opencode 风格状态，并扫描 TUI 表面统一使用 Phase 29 组件
 *
 * 测试用例:
 *   - feedback tone contract covers opencode-style status states:枚举 FEEDBACK_META 与各 tone 解析
 *   - TUI feedback surfaces use shared Phase 29 components:扫描 toast / session / messageListView / prompt / messages / footer / plugin / permission 文件是否引用 getFeedbackMeta 等
 */
import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import {
  FEEDBACK_META,
  feedbackColor,
  feedbackStatusText,
  getFeedbackMeta,
  normalizeFeedbackTone,
} from "@/ui/components/statusFeedback";

describe("Phase 29 Feedback alignment", () => {
  test("feedback tone contract covers opencode-style status states", () => {
    expect(Object.keys(FEEDBACK_META).toSorted()).toEqual([
      "busy",
      "empty",
      "error",
      "info",
      "loading",
      "muted",
      "success",
      "warning",
    ]);
    expect(getFeedbackMeta("loading")).toMatchObject({ busy: true, colorKey: "muted" });
    expect(getFeedbackMeta("busy")).toMatchObject({ busy: true, colorKey: "info" });
    expect(getFeedbackMeta("error")).toMatchObject({ colorKey: "error", icon: "🔴" });
    expect(normalizeFeedbackTone("bad")).toBe("info");
    expect(feedbackStatusText("empty")).toBe("暂无数据");
    expect(feedbackStatusText("error", " boom ")).toBe("boom");
    expect(feedbackColor(getFeedbackMeta("warning"), { text: "#fff", warning: "#f0" })).toBe("#f0");
    expect(feedbackColor(getFeedbackMeta("empty"), { muted: "#888", text: "#fff" })).toBe("#fff");
    expect(feedbackColor(getFeedbackMeta("muted"), { muted: "#888", text: "#fff" })).toBe("#888");
  });

  test("TUI 反馈呈现使用共享 Phase 29 组件", () => {
    const root = path.join(import.meta.dir, "../../../src");
    const files = {
      footer: fs.readFileSync(path.join(root, "ui/pages/session/footer.tsx"), "utf8"),
      messageListView: fs.readFileSync(path.join(root, "ui/pages/session/panels/MessageListView.tsx"), "utf8"),
      messages: fs.readFileSync(path.join(root, "ui/pages/session/components/messages.tsx"), "utf8"),
      permission: fs.readFileSync(path.join(root, "ui/components/permissionDialog.tsx"), "utf8"),
      plugin: fs.readFileSync(path.join(root, "ui/pages/pluginRoute.tsx"), "utf8"),
      prompt: fs.readFileSync(path.join(root, "ui/pages/session/components/promptInput.tsx"), "utf8"),
      session: fs.readFileSync(path.join(root, "ui/pages/session/index.tsx"), "utf8"),
      toast: fs.readFileSync(path.join(root, "ui/components/toastContainer.tsx"), "utf8"),
    };

    expect(files.toast).toContain("getFeedbackMeta");
    expect(files.session).toContain("MessageListView");
    expect(files.session).toContain("FeedbackLine");
    expect(files.messageListView).toContain("FeedbackPanel");
    expect(files.prompt).toContain('tone="loading"');
    expect(files.messages).toContain('tone="error"');
    expect(files.footer).toContain("permissionLabel");
    expect(files.footer).toContain("lspLabel");
    expect(files.footer).toContain("mcpLabel");
    expect(files.plugin).toContain("FeedbackPanel");
    expect(files.permission).toContain("FeedbackLine");
  });
});
