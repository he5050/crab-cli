/**
 * [测试目标] Session Prompt v2。
 *
 * 测试目标:
 *   - 验证 promptParts / promptAutocomplete / sessionPromptAutocomplete / sessionPromptKeyActions 在 trigger 识别、@ 引用、agent meta 与快捷键上的契约
 *
 * 测试用例:
 *   - detectPromptTrigger 识别 slash 和 context 入口:/、@ 及其 token 形式
 *   - extractPromptReferences 提取结构化 @ context parts:解析 file / agent 引用
 *   - buildPromptMeta 输出 agent mode model:组装 "agent · mode · model" 形式
 *   - insertPromptReference 替换当前 @ token 或追加 context:覆盖替换 token 与追加两种路径
 *   - 其余用例覆盖 applyPromptAutocompleteSelection / nextAutocompleteIndex / resolveSessionPromptKeyAction
 */
import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import {
  buildPromptMeta,
  detectPromptTrigger,
  extractPromptReferences,
  insertPromptReference,
} from "@/ui/pages/session/components/promptParts";
import {
  applyPromptAutocompleteSelection,
  buildPromptAutocompleteOptions,
} from "@/ui/pages/session/components/promptAutocomplete";
import {
  buildSessionPromptAutocompleteSources,
  nextAutocompleteIndex,
  normalizeSessionRecentFile,
} from "@/ui/pages/session/sessionPromptAutocomplete";
import { resolveSessionPromptKeyAction } from "@/ui/pages/session/sessionPromptKeyActions";

describe("Session Prompt v2", () => {
  test("detectPromptTrigger 识别 slash 和 context 入口", () => {
    expect(detectPromptTrigger("/")).toBe("/");
    expect(detectPromptTrigger("/resume")).toBe("/");
    expect(detectPromptTrigger("@")).toBe("@");
    expect(detectPromptTrigger("@src/app.tsx")).toBe("@");
    expect(detectPromptTrigger("hello @src/app.tsx")).toBeUndefined();
  });

  test("extractPromptReferences 提取结构化 @ context parts", () => {
    expect(extractPromptReferences("读 @src/app.tsx 和 @agent:review")).toEqual([
      { kind: "file", raw: "@src/app.tsx", value: "src/app.tsx" },
      { kind: "agent", raw: "@agent:review", value: "agent:review" },
    ]);
  });

  test("buildPromptMeta 输出 agent mode model", () => {
    expect(
      buildPromptMeta({
        agent: "General Agent",
        mode: "build",
        model: "gpt-5.1",
        provider: "openai",
      }),
    ).toBe("General Agent · build · gpt-5.1");
  });

  test("insertPromptReference 替换当前 @ token 或追加 context", () => {
    expect(insertPromptReference("@sr", { kind: "file", raw: "@src/app.tsx", value: "src/app.tsx" })).toBe(
      "@src/app.tsx ",
    );
    expect(insertPromptReference("检查", { kind: "skill", raw: "@skill:audit", value: "skill:audit" })).toBe(
      "检查 @skill:audit ",
    );
  });

  test("Prompt autocomplete 构造 slash 命令与 @ 引用候选", () => {
    const sources = {
      agents: ["review"],
      commands: [
        { description: "open timeline", name: "session.timeline", slashName: "timeline", title: "Timeline" },
        { description: "open diff", name: "session.diff", slashName: "diff", title: "Diff" },
      ],
      recentFiles: ["src/ui/app.tsx", "README.md"],
      skills: ["audit"],
    };

    expect(buildPromptAutocompleteOptions("/", "ti", sources)[0]).toMatchObject({
      display: "/timeline",
      kind: "command",
      raw: "/timeline ",
    });

    const refs = buildPromptAutocompleteOptions("@", "aud", sources);
    expect(refs.map((item) => item.raw)).toContain("@skill:audit");
  });

  test("Prompt autocomplete selection 复用 slash 填充与 @ token 替换", () => {
    const command = buildPromptAutocompleteOptions("/", "di", {
      agents: [],
      commands: [{ name: "session.diff", slashName: "diff", title: "Diff" }],
      recentFiles: [],
      skills: [],
    })[0]!;
    expect(applyPromptAutocompleteSelection("/di", "/", command)).toBe("/diff ");

    const file = buildPromptAutocompleteOptions("@", "app", {
      agents: [],
      commands: [],
      recentFiles: ["src/app.tsx"],
      skills: [],
    })[0]!;
    expect(applyPromptAutocompleteSelection("@ap", "@", file)).toBe("@src/app.tsx ");
  });

  test("Session prompt autocomplete sources normalize recent files and cap list length", () => {
    const cwd = "/work/project";
    const files = [
      "/work/project/src/app.tsx",
      "/other/file.ts",
      ...Array.from({ length: 26 }, (_, index) => `/work/project/src/file-${index}.ts`),
    ];

    expect(normalizeSessionRecentFile("/work/project/src/app.tsx", cwd)).toBe("src/app.tsx");
    expect(normalizeSessionRecentFile("/other/file.ts", cwd)).toBe("/other/file.ts");

    const sources = buildSessionPromptAutocompleteSources({
      agents: ["plan"],
      commands: [{ name: "session.diff", slashName: "diff", title: "Diff" }],
      cwd,
      recentFiles: files,
      skills: ["audit"],
    });

    expect(sources.commands).toHaveLength(1);
    expect(sources.recentFiles).toHaveLength(24);
    expect(sources.recentFiles[0]).toBe("src/app.tsx");
    expect(sources.recentFiles[1]).toBe("/other/file.ts");
    expect(sources.agents).toEqual(["plan"]);
    expect(sources.skills).toEqual(["audit"]);
  });

  test("Session prompt autocomplete index wraps around option boundaries", () => {
    expect(nextAutocompleteIndex(0, 3, -1)).toBe(2);
    expect(nextAutocompleteIndex(2, 3, 1)).toBe(0);
    expect(nextAutocompleteIndex(1, 3, 1)).toBe(2);
    expect(nextAutocompleteIndex(5, 0, 1)).toBe(0);
  });

  test("Session prompt key action prioritizes autocomplete navigation over history", () => {
    expect(
      resolveSessionPromptKeyAction({
        autocompleteOpen: true,
        cursorOffset: 0,
        event: { name: "up" },
        inputLength: 4,
      }),
    ).toBe("autocompletePrevious");

    expect(
      resolveSessionPromptKeyAction({
        autocompleteOpen: true,
        cursorOffset: 4,
        event: { ctrl: true, name: "down" },
        inputLength: 4,
      }),
    ).toBe("autocompleteNext");

    expect(
      resolveSessionPromptKeyAction({
        autocompleteOpen: true,
        cursorOffset: 4,
        event: { name: "enter" },
        inputLength: 4,
      }),
    ).toBe("autocompleteSelect");
  });

  test("Session prompt key action derives history and stash shortcuts", () => {
    expect(
      resolveSessionPromptKeyAction({
        autocompleteOpen: false,
        cursorOffset: 0,
        event: { name: "up" },
        inputLength: 8,
      }),
    ).toBe("historyPrevious");

    expect(
      resolveSessionPromptKeyAction({
        autocompleteOpen: false,
        cursorOffset: 8,
        event: { name: "down" },
        inputLength: 8,
      }),
    ).toBe("historyNext");

    expect(
      resolveSessionPromptKeyAction({
        autocompleteOpen: false,
        cursorOffset: 8,
        event: { ctrl: true, name: "s", shift: true },
        inputLength: 8,
      }),
    ).toBe("stashCurrent");

    expect(
      resolveSessionPromptKeyAction({
        autocompleteOpen: false,
        cursorOffset: 8,
        event: { ctrl: true, name: "r", shift: true },
        inputLength: 8,
      }),
    ).toBe("restoreLastStash");

    expect(
      resolveSessionPromptKeyAction({
        autocompleteOpen: false,
        cursorOffset: 8,
        event: { ctrl: true, name: "l", shift: true },
        inputLength: 8,
      }),
    ).toBe("openStashList");
  });

  test("PromptInput source follows textarea prompt v2 contract", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/ui/pages/session/components/promptInput.tsx"), "utf8");
    expect(source).toContain("<textarea");
    expect(source).toContain("onContentChange");
    expect(source).toContain("Shift/Ctrl/Alt+Enter 换行");
    expect(source).toContain("↑↓ 历史");
    expect(source).toContain("/ 命令");
    expect(source).toContain("/ 命令");
    expect(source).toContain("上下文");
  });
});
