/**
 * [测试目标] 差异插件路由。
 *
 * 测试目标:
 *   - 验证 pluginDiffModel 与 toolDiffRoute 模块在 diff 解析、文件夹折叠、视图模式、缓存与路由数据上的契约
 *
 * 测试用例:
 *   - 覆盖 buildDiffTreeRows / clampFileIndex / parseDiffFiles 等解析与裁剪逻辑
 *   - 验证 buildToolDiffRoute / buildSessionDiffRouteData / getOrBuildSessionDiffCacheEntry 的缓存与路由数据
 */
import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import {
  DIFF_VIEWER_SHOW_FILE_TREE_KEY,
  DIFF_VIEWER_SINGLE_PATCH_KEY,
  DIFF_VIEWER_VIEW_KEY,
  buildDiffTreeRows,
  clampDiffTreeRowIndex,
  clampFileIndex,
  clampSourceIndex,
  findDiffFileIndex,
  findDiffTreeRowIndexForFile,
  formatDiffTreeRowPrefix,
  formatDiffTreeRowStatus,
  getDiffFolderPaths,
  getDiffSourceLabel,
  getDiffSourceOptions,
  getParentFolderPath,
  isDiffViewerSplitAvailable,
  moveDiffFileIndex,
  parseDiffFiles,
  resolveDiffViewerView,
  storedDiffViewerView,
  summarizeDiffFiles,
  toggleExpandedFolder,
} from "@/ui/pages/pluginDiffModel";
import {
  buildSessionDiffRouteData,
  buildToolDiffRoute,
  buildToolDiffRouteData,
  clearSessionDiffCache,
  getCachedSessionDiff,
  getOrBuildSessionDiffCacheEntry,
} from "@/ui/pages/session/components/toolDiffRoute";
import type { MessageRecord } from "@/session/type";

const SRC = path.join(import.meta.dir, "../../../src");

function readSource(relPath: string): string {
  return fs.readFileSync(path.join(SRC, relPath), "utf8");
}

const SAMPLE_DIFF = [
  "diff --git a/src/a.ts b/src/a.ts",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1,2 +1,2 @@",
  "-old",
  "+new",
  " keep",
  "diff --git a/src/b.ts b/src/b.ts",
  "--- a/src/b.ts",
  "+++ b/src/b.ts",
  "@@ -1 +1,2 @@",
  "+added",
].join("\n");

const NESTED_DIFF = [
  "diff --git a/src/ui/a.ts b/src/ui/a.ts",
  "--- a/src/ui/a.ts",
  "+++ b/src/ui/a.ts",
  "@@ -1 +1 @@",
  "-old",
  "+new",
  "diff --git a/src/core/b.ts b/src/core/b.ts",
  "--- a/src/core/b.ts",
  "+++ b/src/core/b.ts",
  "@@ -1 +1 @@",
  "+added",
  "diff --git a/README.md b/README.md",
  "--- a/README.md",
  "+++ b/README.md",
  "@@ -1 +1 @@",
  "+doc",
].join("\n");

describe("Diff Plugin Route", () => {
  test("parseDiffFiles 拆分多文件 diff 并统计 additions/deletions", () => {
    const files = parseDiffFiles(SAMPLE_DIFF);
    expect(
      files.map((file) => ({
        additions: file.additions,
        deletions: file.deletions,
        hunks: file.hunks,
        path: file.path,
      })),
    ).toEqual([
      { additions: 1, deletions: 1, hunks: 1, path: "src/a.ts" },
      { additions: 1, deletions: 0, hunks: 1, path: "src/b.ts" },
    ]);
    expect(files[0]!.diff).toContain("diff --git a/src/a.ts");
    expect(files[1]!.diff).not.toContain("diff --git a/src/a.ts");
  });

  test("summarizeDiffFiles 汇总文件数量和变更行", () => {
    expect(summarizeDiffFiles(parseDiffFiles(SAMPLE_DIFF))).toEqual({
      additions: 2,
      deletions: 1,
      files: 2,
    });
  });

  test("getDiffSourceLabel 输出 route source 文案", () => {
    expect(getDiffSourceLabel({ args: "--staged", source: "git" })).toBe("git diff --staged");
    expect(getDiffSourceLabel({ source: "tool" })).toBe("tool diff");
    expect(getDiffSourceLabel({ source: "session" })).toBe("session diff");
  });

  test("clampFileIndex 支持 diff 文件循环导航", () => {
    const files = parseDiffFiles(SAMPLE_DIFF);
    expect(clampFileIndex(-1, files)).toBe(1);
    expect(clampFileIndex(2, files)).toBe(0);
    expect(clampFileIndex(1, files)).toBe(1);
  });

  test("getDiffSourceOptions 支持 Phase 12 多 source route data", () => {
    const options = getDiffSourceOptions({
      args: "--staged",
      diff: SAMPLE_DIFF,
      source: "git",
      sources: [
        {
          callId: "call_1",
          diff: SAMPLE_DIFF.replace("src/b.ts", "src/c.ts"),
          id: "tool-call",
          label: "edit tool",
          selectedFile: "src/c.ts",
          source: "tool",
          tool: "filesystem-edit",
        },
      ],
    });

    expect(
      options.map((option) => ({
        id: option.id,
        label: option.label,
        selectedFile: option.selectedFile,
        source: option.source,
      })),
    ).toEqual([
      { id: "source-0", label: "git diff --staged", selectedFile: undefined, source: "git" },
      { id: "tool-call", label: "edit tool", selectedFile: "src/c.ts", source: "tool" },
    ]);
    expect(clampSourceIndex(-1, options)).toBe(1);
    expect(clampSourceIndex(2, options)).toBe(0);
  });

  test("buildDiffTreeRows 支持 Phase 14 文件树目录展开折叠", () => {
    const files = parseDiffFiles(NESTED_DIFF);
    expect(getDiffFolderPaths(files)).toEqual(["src", "src/core", "src/ui"]);
    expect(getParentFolderPath("src/ui/a.ts")).toBe("src/ui");

    const expandedRows = buildDiffTreeRows(files, getDiffFolderPaths(files));
    expect(
      expandedRows.map((row) => ({
        depth: row.depth,
        fileIndex: row.fileIndex,
        kind: row.kind,
        path: row.path,
      })),
    ).toEqual([
      { depth: 0, fileIndex: undefined, kind: "folder", path: "src" },
      { depth: 1, fileIndex: undefined, kind: "folder", path: "src/core" },
      { depth: 2, fileIndex: 1, kind: "file", path: "src/core/b.ts" },
      { depth: 1, fileIndex: undefined, kind: "folder", path: "src/ui" },
      { depth: 2, fileIndex: 0, kind: "file", path: "src/ui/a.ts" },
      { depth: 0, fileIndex: 2, kind: "file", path: "README.md" },
    ]);

    const collapsed = toggleExpandedFolder(getDiffFolderPaths(files), "src");
    expect(collapsed).toEqual(["src/core", "src/ui"]);
    expect(buildDiffTreeRows(files, collapsed).map((row) => row.path)).toEqual(["src", "README.md"]);
  });

  test("findDiffFileIndex 支持工具 diff route 初始选中文件", () => {
    const files = parseDiffFiles(SAMPLE_DIFF);
    expect(findDiffFileIndex(files, "src/b.ts")).toBe(1);
    expect(findDiffFileIndex(files, "b/src/a.ts")).toBe(0);
    expect(findDiffFileIndex(files, "missing.ts")).toBe(0);
  });

  test("Phase 28 差异查看器 KV 键与拆分回退辅助函数", () => {
    expect(DIFF_VIEWER_SHOW_FILE_TREE_KEY).toBe("diff_viewer_show_file_tree");
    expect(DIFF_VIEWER_SINGLE_PATCH_KEY).toBe("diff_viewer_single_patch");
    expect(DIFF_VIEWER_VIEW_KEY).toBe("diff_viewer_view");
    expect(storedDiffViewerView("split")).toBe("split");
    expect(storedDiffViewerView("unified")).toBe("unified");
    expect(storedDiffViewerView("bad")).toBeUndefined();
    expect(isDiffViewerSplitAvailable(99)).toBe(false);
    expect(isDiffViewerSplitAvailable(100)).toBe(true);
    expect(resolveDiffViewerView("split", false)).toBe("unified");
    expect(resolveDiffViewerView(undefined, true)).toBe("split");
    expect(resolveDiffViewerView(undefined, true, "stacked")).toBe("unified");
    expect(resolveDiffViewerView("unified", true)).toBe("unified");
  });

  test("Phase 28 diff file tree mirrors opencode focus/status helpers", () => {
    const files = parseDiffFiles(
      [
        "diff --git a/src/new.ts b/src/new.ts",
        "new file mode 100644",
        "--- /dev/null",
        "+++ b/src/new.ts",
        "@@ -0,0 +1 @@",
        "+new",
        "diff --git a/src/old.ts b/src/old.ts",
        "deleted file mode 100644",
        "--- a/src/old.ts",
        "+++ /dev/null",
        "@@ -1 +0,0 @@",
        "-old",
      ].join("\n"),
    );
    const rows = buildDiffTreeRows(files, getDiffFolderPaths(files));

    expect(files.map((file) => ({ path: file.path, status: file.status }))).toEqual([
      { path: "src/new.ts", status: "added" },
      { path: "src/old.ts", status: "deleted" },
    ]);
    expect(moveDiffFileIndex(0, files, -1)).toBe(0);
    expect(moveDiffFileIndex(0, files, 1)).toBe(1);
    expect(moveDiffFileIndex(1, files, 1)).toBe(1);
    expect(clampDiffTreeRowIndex(-1, rows)).toBe(0);
    expect(clampDiffTreeRowIndex(99, rows)).toBe(rows.length - 1);
    expect(findDiffTreeRowIndexForFile(rows, 1)).toBeGreaterThan(0);
    expect(formatDiffTreeRowPrefix(rows, 0)).toContain("▾");
    expect(formatDiffTreeRowStatus(rows.find((row) => row.path === "src/new.ts")!, false)).toBe(" A");
    expect(formatDiffTreeRowStatus(rows.find((row) => row.path === "src/old.ts")!, true)).toBe("✓D");
  });

  test("buildToolDiffRouteData 从工具 part hydration diff route data", () => {
    const routeData = buildToolDiffRouteData({
      callId: "call_edit_1",
      input: { file_path: "src/a.ts" },
      metadata: { diff: SAMPLE_DIFF },
      success: true,
      tool: "filesystem-edit",
      type: "tool",
    });
    expect(routeData).toEqual({
      callId: "call_edit_1",
      diff: SAMPLE_DIFF,
      filename: "src/a.ts",
      selectedFile: "src/a.ts",
      source: "tool",
      tool: "filesystem-edit",
    });
  });

  test("buildToolDiffRoute 写入 plugin returnRoute", () => {
    const route = buildToolDiffRoute(
      {
        callId: "call_edit_1",
        input: { file_path: "src/a.ts" },
        metadata: { diff: SAMPLE_DIFF },
        success: true,
        tool: "filesystem-edit",
        type: "tool",
      },
      { sessionId: "ses_return", type: "session" },
    );

    expect(route).toMatchObject({
      id: "diff",
      returnRoute: { sessionId: "ses_return", type: "session" },
      type: "plugin",
    });
  });

  test("buildSessionDiffRouteData 从 Session 工具消息聚合 session diff source", () => {
    const routeData = buildSessionDiffRouteData([
      {
        content: "",
        id: "msg-1",
        parts: [
          {
            callId: "call_edit_1",
            input: { file_path: "src/a.ts" },
            metadata: { diff: SAMPLE_DIFF },
            success: true,
            tool: "filesystem-edit",
            type: "tool",
          },
          {
            text: "done",
            type: "text",
          },
        ],
        role: "assistant",
      },
      {
        content: "",
        id: "msg-2",
        parts: [
          {
            callId: "call_patch_2",
            input: { path: "src/c.ts" },
            metadata: { patch: SAMPLE_DIFF.replaceAll("src/a.ts", "src/c.ts") },
            success: true,
            tool: "apply_patch",
            type: "tool",
          },
        ],
        role: "assistant",
      },
    ]);

    expect(routeData?.source).toBe("session");
    expect(routeData?.label).toBe("session diff");
    expect(routeData?.selectedFile).toBe("src/a.ts");
    expect(routeData?.sources).toHaveLength(2);
    expect(
      routeData?.sources.map((source) => ({
        id: source.id,
        selectedFile: source.selectedFile,
        source: source.source,
        tool: source.tool,
      })),
    ).toEqual([
      { id: "call_edit_1", selectedFile: "src/a.ts", source: "tool", tool: "filesystem-edit" },
      { id: "call_patch_2", selectedFile: "src/c.ts", source: "tool", tool: "apply_patch" },
    ]);
    expect(routeData?.diff).toContain("diff --git a/src/a.ts");
    expect(routeData?.diff).toContain("diff --git a/src/c.ts");
  });

  test("Session diff cache 支持命中和 updatedAt 失效", () => {
    clearSessionDiffCache();
    const messages: MessageRecord[] = [
      {
        createdAt: 1,
        id: "msg-1",
        parts: [
          {
            callId: "call_edit_1",
            content: JSON.stringify({ file_path: "src/a.ts" }),
            input: { file_path: "src/a.ts" },
            metadata: { diff: SAMPLE_DIFF },
            tool_name: "filesystem-edit",
            tool_use_id: "call_edit_1",
            type: "tool_use",
          },
          {
            callId: "call_edit_1",
            content: "",
            metadata: { diff: SAMPLE_DIFF },
            result: "",
            success: true,
            tool_use_id: "call_edit_1",
            type: "tool_result",
          },
        ],
        role: "assistant",
        sessionId: "ses_cache",
      },
    ];

    const first = getOrBuildSessionDiffCacheEntry({ messages, sessionId: "ses_cache", updatedAt: 1 });
    const second = getOrBuildSessionDiffCacheEntry({ messages, sessionId: "ses_cache", updatedAt: 1 });
    const refreshed = getOrBuildSessionDiffCacheEntry({
      messages: [
        {
          ...messages[0]!,
          parts: messages[0]!.parts.map((part) => ({
            ...part,
            ...("input" in part
              ? { content: JSON.stringify({ file_path: "src/z.ts" }), input: { file_path: "src/z.ts" } }
              : {}),
            metadata: { diff: SAMPLE_DIFF.replaceAll("src/a.ts", "src/z.ts") },
          })),
        },
      ],
      sessionId: "ses_cache",
      updatedAt: 2,
    });

    expect(first).toBeDefined();
    expect(second).toBe(first);
    expect(first?.summaryText).toBe("2 files · +2 -1");
    expect(refreshed).toBeDefined();
    expect(refreshed).not.toBe(first);
    expect(getCachedSessionDiff("ses_cache", 1)).toBeUndefined();
    expect(getCachedSessionDiff("ses_cache", 2)).toBe(refreshed);
    expect(refreshed?.routeData.selectedFile).toBe("src/z.ts");
  });

  test("PluginRoute 源包含 Phase 10 差异查看器契约", () => {
    const pluginSource = readSource("ui/pages/pluginRoute.tsx");
    const commandSource = readSource("commandPalette/categories/ide/gitCodebase.ts");

    expect(pluginSource).toContain("Diff 查看器");
    expect(pluginSource).toContain("parseDiffFiles");
    expect(pluginSource).toContain("showTree");
    expect(pluginSource).toContain("showHelp");
    expect(pluginSource).toContain("viewOverride");
    expect(pluginSource).toContain("resolveDiffViewerView");
    expect(pluginSource).toContain("isDiffViewerSplitAvailable");
    expect(pluginSource).toContain("moveDiffFileIndex");
    expect(pluginSource).toContain("highlightedRowIndex");
    expect(pluginSource).toContain("patchScroll");
    expect(pluginSource).toContain("<scrollbox");
    expect(pluginSource).toContain("formatDiffTreeRowStatus");
    expect(pluginSource).toContain("DIFF_VIEWER_SHOW_FILE_TREE_KEY");
    expect(pluginSource).toContain("DIFF_VIEWER_SINGLE_PATCH_KEY");
    expect(pluginSource).toContain("DIFF_VIEWER_VIEW_KEY");
    expect(pluginSource).toContain("kv.set(DIFF_VIEWER_SHOW_FILE_TREE_KEY");
    expect(pluginSource).toContain("kv.set(DIFF_VIEWER_SINGLE_PATCH_KEY");
    expect(pluginSource).toContain("kv.set(DIFF_VIEWER_VIEW_KEY");
    expect(pluginSource).toContain("setSourceIndex");
    expect(pluginSource).toContain("getDiffSourceOptions");
    expect(pluginSource).toContain("d 来源");
    expect(pluginSource).toContain("treeRows");
    expect(pluginSource).toContain("toggleFolder");
    expect(pluginSource).toContain("E 展开全部");
    expect(pluginSource).toContain("findDiffFileIndex");
    expect(pluginSource).toContain("selectedFile");
    expect(pluginSource).toContain("n/p 或 ↑/↓ 切换文件");
    expect(pluginSource).toContain("focus");
    expect(pluginSource).toContain("singlePatch");
    expect(pluginSource).toContain("reviewedFileNames");
    expect(pluginSource).toContain("Tab 切换文件/补丁焦点");
    expect(pluginSource).toContain("s 切换单个/全部补丁");
    expect(pluginSource).toContain("m 标记已审阅");
    expect(pluginSource).toContain("PageUp/PageDown 翻页");
    expect(pluginSource).toContain("getReturnRoute");
    expect(pluginSource).toContain('returnRoute ?? { type: "home" }');
    expect(pluginSource).toContain("route.navigate(getReturnRoute(props.route))");
    expect(commandSource).toContain('source: "git"');
  });

  test("Session 工具渲染器暴露 Phase 11 打开查看器契约", () => {
    const renderersSource = readSource("ui/pages/session/components/tools/toolRenderers.tsx");
    expect(renderersSource).toContain("buildToolDiffRoute");
    expect(renderersSource).toContain("openDiffViewer");
    expect(renderersSource).toContain("打开查看器");
    expect(renderersSource).toContain("DiffBody");
  });

  test("Session source includes Phase 13 session diff slash contract", () => {
    const slashSource = readSource("ui/pages/session/sessionSlashCommands.ts");
    expect(slashSource).toContain("buildSessionDiffRoute");
    expect(slashSource).toContain('slashCmd === "diff"');
    expect(slashSource).toContain('slashArgs.trim() === "session"');
    expect(slashSource).toContain("当前 Session 没有可展示的工具 diff");

    const eventsSource = readSource("ui/pages/session/sessionEventHandlers.ts");
    expect(eventsSource).toContain("SessionUndoRequested");
    expect(eventsSource).toContain("SessionRedoRequested");
    expect(eventsSource).toContain("SessionToggleConceal");
  });
});
