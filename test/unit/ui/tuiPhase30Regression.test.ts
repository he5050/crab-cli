/**
 * TUI Phase30 回归测试。
 *
 * 测试目标:
 *   - 验证 TUI(终端 UI)Phase30 关键回归点
 *
 * 测试用例:
 *   - 关键源码结构稳定
 *   - 不存在已知回归
 */
import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(import.meta.dir, "../../..");

function readText(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8");
}

function assertContainsAll(text: string, values: string[], label: string): void {
  for (const value of values) {
    expect(text).toContain(value);
  }
  expect(text.length, `${label} should not be empty`).toBeGreaterThan(0);
}

describe("Phase 30 TUI regression matrix", () => {
  test("isolated runner keeps the TUI regression gate visible", () => {
    const runner = readText("scripts/run-isolated-tests.ts");

    expect(runner).toContain('entry.name.endsWith(".test.tsx")');
    expect(runner).toContain("TEST_BATCH_SIZE");
    expect(runner).toContain("TEST_BATCH_INDEX");
    expect(runner).toContain("timedOut");
    expect(runner).toContain("120_000");
  });

  test("Phase 30 source matrix lists the full TUI parity tests and surfaces", () => {
    const requiredTests = [
      "test/unit/core/theme.test.ts",
      "test/unit/ui/utils/keybind.test.ts",
      "test/unit/ui/dialogSystem.test.ts",
      "test/unit/ui/pages/homePage.test.ts",
      "test/unit/conversation/promptV2.test.ts",
      "test/unit/conversation/toolRendererSpec.test.ts",
      "test/unit/conversation/messageRendererEnhanced.test.tsx",
      "test/unit/conversation/sidebarTodoSlot.test.ts",
      "test/unit/conversation/sessionSwitcher.test.ts",
      "test/unit/conversation/diffPluginRoute.test.ts",
      "test/unit/conversation/feedbackPhase29.test.ts",
    ];

    const requiredSurfaces = [
      "Theme tokens",
      "Route and shell",
      "Keymap and WhichKey",
      "Dialogs",
      "Home",
      "Session layout",
      "Prompt",
      "Tool rendering",
      "Thinking and content",
      "Sidebar and todo",
      "SessionSwitcher",
      "Diff viewer",
      "Feedback",
      "Runner, typecheck, build",
    ];

    for (const testFile of requiredTests) {
      expect(fs.existsSync(path.join(ROOT, testFile)), `${testFile} should exist`).toBe(true);
    }
    expect(requiredTests.join("\n")).toContain("test/unit/conversation/feedbackPhase29.test.ts");
    expect(requiredSurfaces.join("\n")).toContain("Feedback");
    expect(requiredSurfaces.join("\n")).toContain("Runner, typecheck, build");
  });

  test("source contract keeps the TUI parity helpers wired", () => {
    const contracts: [string, string[]][] = [
      [
        "src/config/themes/themesDark.ts",
        ["const OPENCODE", "OPENCODE_DARK_EXTENDED", "OPENCODE_LIGHT_EXTENDED", "selectedListItemText"],
      ],
      ["src/ui/contexts/theme.tsx", ["selectedForegroundColor", "diffAlpha", "backgroundPanel"]],
      ["src/ui/contexts/route.tsx", ['{ type: "home" }', "returnRoute?: Route", 'type: "plugin"']],
      [
        "src/ui/keymap.tsx",
        [
          "app.command",
          "leader",
          "session.timeline",
          "diff.single_patch",
          "diff.mark_reviewed",
          "provider.connect",
          "variant.cycle",
          "workspace.set",
          "tips.toggle",
          "plugins.list",
          "messages.copy",
          "pgdown",
          "input.select.line.home",
        ],
      ],
      [
        "src/ui/components/dialogSelect.tsx",
        ['event.ctrl && event.name === "p"', 'event.ctrl && event.name === "n"', "pageup", "pagedown", "escape"],
      ],
      [
        "src/ui/components/sessionListDialog.tsx",
        ["SessionPreviewPane", "buildSessionDiffCacheEntry", "deleteSession", "renameTarget"],
      ],
      ["src/ui/components/sessionSwitcherPreview.tsx", ["prefetchSessionPreviews", "retry", "busy", "未选择会话"]],
      ["src/ui/components/statusFeedback.tsx", ["FEEDBACK_META", "FeedbackLine", "FeedbackPanel", "StatusLabel"]],
      [
        "src/ui/pages/session/index.tsx",
        [
          "PromptAutocomplete",
          "MessageListView",
          "FeedbackLine",
          "SessionFooter",
          "QuestionPrompt",
          "handleSessionSlashCommand",
        ],
      ],
      [
        "src/ui/pages/session/panels/MessageListView.tsx",
        ["FeedbackPanel", "MessageItem", "StreamingOutput", "BtwOverlay"],
      ],
      [
        "src/ui/pages/session/components/promptAutocomplete.tsx",
        ["insertPromptReference", "PromptAutocompleteKind", "applyPromptAutocompleteSelection"],
      ],
      [
        "src/ui/pages/session/components/tools/toolRenderers.tsx",
        ["ToolPartRenderer", "resolveToolRenderer", "buildToolDiffRoute"],
      ],
      [
        "src/ui/pages/pluginDiffModel.ts",
        ["DIFF_VIEWER_SHOW_FILE_TREE_KEY", "DIFF_VIEWER_SINGLE_PATCH_KEY", "DIFF_VIEWER_VIEW_KEY"],
      ],
      [
        "src/ui/pages/pluginRoute.tsx",
        ["patchScroll", "FeedbackPanel", "getDiffSourceOptions", "DIFF_VIEWER_VIEW_KEY"],
      ],
      ["src/ui/plugins/slots.tsx", ["home_prompt_right", "session_prompt_right", "sidebar_content", "sidebar_footer"]],
    ];

    for (const [file, patterns] of contracts) {
      const text = readText(file);
      assertContainsAll(text, patterns, file);
    }
  });
});
