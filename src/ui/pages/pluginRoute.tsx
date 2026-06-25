/**
 * PluginRoute — 插件路由页面
 *
 * 职责:
 *   - Diff route 提供文件树、source、view 和 help 基线
 *   - 提供插件视图的渲染框架
 *
 * 模块功能:
 *   - PluginRoute: 插件路由组件
 *   - DiffViewer: 差异查看器组件
 *   - buildDiffTreeRows: 构建差异树行
 *
 * 使用场景:
 *   - 插件页面渲染
 *   - 差异查看
 *
 * 边界:
 * 1. 提供文件树、source、view 和 help 基线
 * 2. 不处理具体的插件逻辑
 *
 * 流程:
 * 1. 暂无(这是路由组件，无特定执行流程)
 */
import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import { useKeyboard, useTerminalDimensions } from "@opentui/solid";
import type { Route } from "@/ui/contexts/route";
import { useRoute } from "@/ui/contexts/route";
import { useTheme } from "@/ui/contexts/theme";
import { useKV } from "@/ui/contexts/kv";
import { DiffViewer } from "@/ui/components/diffViewer";
import { FeedbackPanel } from "@/ui/components/statusFeedback";
import { getGlobalPluginRoute, usePluginRoutes } from "@/ui/plugins/slots";
import {
  DIFF_VIEWER_SHOW_FILE_TREE_KEY,
  DIFF_VIEWER_SINGLE_PATCH_KEY,
  DIFF_VIEWER_VIEW_KEY,
  type DiffViewMode,
  buildDiffTreeRows,
  clampDiffTreeRowIndex,
  clampFileIndex,
  clampSourceIndex,
  findDiffFileIndex,
  findDiffTreeRowIndexForFile,
  formatDiffTreeRowPrefix,
  formatDiffTreeRowStatus,
  getDiffFolderPaths,
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

type PluginRouteData = Extract<Route, { type: "plugin" }>;

function getString(data: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = data?.[key];
  return typeof value === "string" ? value : undefined;
}

function getReturnRoute(route: PluginRouteData): Route {
  return route.returnRoute ?? { type: "home" };
}

export function PluginRoute(props: { route: PluginRouteData }) {
  const pluginId = () => props.route.id;

  // 优先检查通过 createPluginRoutes() 注册的自定义路由
  const registeredRenderer = createMemo(() => getGlobalPluginRoute(pluginId()));

  return (
    <Show
      when={registeredRenderer()}
      fallback={
        <Show when={pluginId() === "diff"} fallback={<PluginRouteMissing route={props.route} />}>
          <DiffPluginRoute route={props.route} />
        </Show>
      }
    >
      {() => {
        const renderer = registeredRenderer()!;
        return renderer({ id: pluginId(), data: props.route.data });
      }}
    </Show>
  );
}

function DiffPluginRoute(props: { route: PluginRouteData }) {
  const route = useRoute();
  const theme = useTheme();
  const kv = useKV();
  const dimensions = useTerminalDimensions();
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const [highlightedRowIndex, setHighlightedRowIndex] = createSignal(0);
  const [sourceIndex, setSourceIndex] = createSignal(0);
  const [showTree, setShowTree] = createSignal(kv.get<boolean>(DIFF_VIEWER_SHOW_FILE_TREE_KEY) !== false);
  const [showHelp, setShowHelp] = createSignal(false);
  const [expandedFolders, setExpandedFolders] = createSignal<string[]>([]);
  const [viewOverride, setViewOverride] = createSignal<DiffViewMode | undefined>(
    storedDiffViewerView(kv.get(DIFF_VIEWER_VIEW_KEY)),
  );
  const [focus, setFocus] = createSignal<"files" | "patches">("files");
  const [singlePatch, setSinglePatch] = createSignal(kv.get<boolean>(DIFF_VIEWER_SINGLE_PATCH_KEY) === true);
  const [reviewedFileNames, setReviewedFileNames] = createSignal<string[]>([]);
  let patchScroll: { scrollBy?: (offset: number) => void; height?: number } | undefined;
  const data = () => props.route.data;
  const sources = createMemo(() => getDiffSourceOptions(data()));
  createEffect(() => {
    setSourceIndex((index) => clampSourceIndex(index, sources()));
  });
  const activeSource = createMemo(() => sources()[clampSourceIndex(sourceIndex(), sources())]);
  const diff = () => activeSource()?.diff ?? getString(data(), "diff") ?? "";
  const filename = () => activeSource()?.filename ?? getString(data(), "filename");
  const selectedFileName = () => activeSource()?.selectedFile ?? getString(data(), "selectedFile") ?? filename();
  const files = createMemo(() => parseDiffFiles(diff()));
  const summary = createMemo(() => summarizeDiffFiles(files()));
  const showFileTree = createMemo(() => showTree() && files().length > 0);
  const patchPaneWidth = createMemo(() => dimensions().width - (showFileTree() ? 34 : 0) - 4);
  const splitAvailable = createMemo(() => isDiffViewerSplitAvailable(patchPaneWidth()));
  const view = createMemo(() => resolveDiffViewerView(viewOverride(), splitAvailable()));
  createEffect(() => {
    const available = splitAvailable();
    const requested = viewOverride();
    if (!available && requested === "split") {
      setViewOverride("unified");
      kv.set(DIFF_VIEWER_VIEW_KEY, "unified");
    }
  });
  const folderPaths = createMemo(() => getDiffFolderPaths(files()));
  createEffect(() => {
    setExpandedFolders(folderPaths());
  });
  const treeRows = createMemo(() => buildDiffTreeRows(files(), expandedFolders()));
  createEffect(() => {
    const nextIndex = findDiffFileIndex(files(), selectedFileName());
    setSelectedIndex(nextIndex);
    setHighlightedRowIndex(findDiffTreeRowIndexForFile(treeRows(), nextIndex));
  });
  const selectedFile = createMemo(() => files()[clampFileIndex(selectedIndex(), files())]);
  const highlightedRow = createMemo(() => treeRows()[clampDiffTreeRowIndex(highlightedRowIndex(), treeRows())]);
  const sourceLabel = createMemo(() => activeSource()?.label ?? "git diff");
  const selectedFolder = createMemo(() => {
    const row = highlightedRow();
    if (row?.kind === "folder") {
      return row.path;
    }
    return getParentFolderPath(row?.path ?? selectedFile()?.path);
  });
  const selectedPath = createMemo(() => selectedFile()?.path);
  const selectedReviewed = createMemo(() => {
    const path = selectedPath();
    return Boolean(path) && reviewedFileNames().includes(path!);
  });
  const activeDiff = createMemo(() => (singlePatch() ? (selectedFile()?.diff ?? diff()) : diff()));
  const activeFilename = createMemo(() => (singlePatch() ? (selectedFile()?.path ?? filename()) : sourceLabel()));

  const toggleFolder = (folderPath: string | undefined) => {
    setExpandedFolders((folders) => toggleExpandedFolder(folders, folderPath));
  };

  const highlightFile = (fileIndex: number) => {
    setSelectedIndex(fileIndex);
    setHighlightedRowIndex(findDiffTreeRowIndexForFile(treeRows(), fileIndex));
  };

  const moveFile = (offset: number) => {
    const next = moveDiffFileIndex(clampFileIndex(selectedIndex(), files()), files(), offset);
    highlightFile(next);
  };

  const moveFileTreeFocus = (offset: number) => {
    const nextRowIndex = clampDiffTreeRowIndex(highlightedRowIndex() + offset, treeRows());
    setHighlightedRowIndex(nextRowIndex);
    const row = treeRows()[nextRowIndex];
    if (typeof row?.fileIndex === "number") {
      setSelectedIndex(row.fileIndex);
    }
  };

  const toggleReviewed = (path = selectedPath()) => {
    if (!path) {
      return;
    }
    setReviewedFileNames((names) => {
      const reviewed = new Set(names);
      if (reviewed.has(path)) {
        reviewed.delete(path);
      } else {
        reviewed.add(path);
      }
      return [...reviewed].toSorted((a, b) => a.localeCompare(b));
    });
  };

  const isReviewed = (path: string | undefined) => Boolean(path) && reviewedFileNames().includes(path!);

  useKeyboard((event) => {
    if (showHelp() && (event.name === "escape" || event.name === "q" || event.name === "?")) {
      setShowHelp(false);
      event.stopPropagation();
      return;
    }
    if (event.name === "q" || event.name === "escape") {
      route.navigate(getReturnRoute(props.route));
      event.stopPropagation();
      return;
    }
    if (event.name === "?") {
      setShowHelp(true);
      event.stopPropagation();
      return;
    }
    if (event.name === "b") {
      setShowTree((visible) => {
        const next = !visible;
        kv.set(DIFF_VIEWER_SHOW_FILE_TREE_KEY, next);
        if (!next) {
          setFocus("patches");
        }
        return next;
      });
      event.stopPropagation();
      return;
    }
    if (event.name === "tab" && showFileTree()) {
      setFocus((current) => (current === "files" ? "patches" : "files"));
      event.stopPropagation();
      return;
    }
    if (event.name === "E") {
      setExpandedFolders(folderPaths());
      event.stopPropagation();
      return;
    }
    if (event.name === "s") {
      setSinglePatch((single) => {
        const next = !single;
        kv.set(DIFF_VIEWER_SINGLE_PATCH_KEY, next);
        const row = highlightedRow();
        if (next && typeof row?.fileIndex === "number") {
          highlightFile(row.fileIndex);
        }
        return next;
      });
      event.stopPropagation();
      return;
    }
    if (event.name === "m") {
      const row = highlightedRow();
      toggleReviewed(focus() === "files" && row?.kind === "file" ? row.path : selectedPath());
      event.stopPropagation();
      return;
    }
    if (event.name === "return" || event.name === "enter" || event.name === "space") {
      if (focus() === "files") {
        const row = highlightedRow();
        if (row?.kind === "folder") {
          toggleFolder(row.path);
        }
        if (typeof row?.fileIndex === "number") {
          highlightFile(row.fileIndex);
        }
      }
      event.stopPropagation();
      return;
    }
    if (event.name === "left") {
      if (focus() === "files") {
        const folder = selectedFolder();
        if (folder) {
          setExpandedFolders((folders) => folders.filter((item) => item !== folder));
        }
      }
      event.stopPropagation();
      return;
    }
    if (event.name === "right") {
      if (focus() === "files") {
        const row = highlightedRow();
        const folder = row?.kind === "folder" ? row.path : selectedFolder();
        if (folder) {
          setExpandedFolders((folders) => [...new Set([...folders, folder])].toSorted((a, b) => a.localeCompare(b)));
        }
      }
      event.stopPropagation();
      return;
    }
    if (event.name === "v") {
      if (!splitAvailable()) {
        event.stopPropagation();
        return;
      }
      setViewOverride((current) => {
        const next = current === "unified" ? "split" : "unified";
        kv.set(DIFF_VIEWER_VIEW_KEY, next);
        return next;
      });
      event.stopPropagation();
      return;
    }
    if (event.name === "d") {
      setSourceIndex((index) => clampSourceIndex(index + 1, sources()));
      event.stopPropagation();
      return;
    }
    if (event.name === "pagedown") {
      if (focus() === "files") {
        moveFileTreeFocus(8);
      } else {
        patchScroll?.scrollBy?.(patchScroll.height ?? 8);
      }
      event.stopPropagation();
      return;
    }
    if (event.name === "pageup") {
      if (focus() === "files") {
        moveFileTreeFocus(-8);
      } else {
        patchScroll?.scrollBy?.(-(patchScroll.height ?? 8));
      }
      event.stopPropagation();
      return;
    }
    if (event.name === "n") {
      moveFile(1);
      event.stopPropagation();
      return;
    }
    if (event.name === "p") {
      moveFile(-1);
      event.stopPropagation();
      return;
    }
    if (event.name === "down") {
      if (focus() === "files") {
        moveFileTreeFocus(1);
      } else {
        patchScroll?.scrollBy?.(1);
      }
      event.stopPropagation();
      return;
    }
    if (event.name === "up") {
      if (focus() === "files") {
        moveFileTreeFocus(-1);
      } else {
        patchScroll?.scrollBy?.(-1);
      }
      event.stopPropagation();
    }
  });

  return (
    <box flexDirection="column" flexGrow={1} padding={1} backgroundColor={theme.colors.background}>
      <box flexDirection="row" justifyContent="space-between" paddingBottom={1}>
        <box flexDirection="column">
          <text fg={theme.colors.primary}>Diff 查看器</text>
          <text fg={theme.colors.muted}>
            {sourceLabel()} · {summary().files} 个文件 · +{summary().additions} -{summary().deletions} · {view()} ·{" "}
            {singlePatch() ? "单个补丁" : "全部补丁"} · 已审阅 {reviewedFileNames().length}/{summary().files} · 焦点{" "}
            {focus()} · 来源 {clampSourceIndex(sourceIndex(), sources()) + 1}/{Math.max(sources().length, 1)}
          </text>
        </box>
        <text fg={theme.colors.muted}>
          q/Esc 返回 · ? 帮助 · Tab 切换焦点 · b 文件树 · s 单补丁 · m 标记审阅 · v 视图 · d 来源
        </text>
      </box>

      <Show
        when={diff().trim().length > 0}
        fallback={
          <box flexGrow={1} alignItems="center" justifyContent="center">
            <FeedbackPanel
              tone="empty"
              title="暂无 diff"
              message="当前没有可展示的 diff"
              hint="q/Esc 返回来源页面"
              width={48}
            />
          </box>
        }
      >
        <box flexDirection="row" flexGrow={1} minHeight={0}>
          <Show when={showFileTree()}>
            <box
              width={34}
              flexShrink={0}
              border={["right"]}
              borderColor={theme.extended.borderExt.subtle}
              paddingRight={1}
            >
              <box flexDirection="column" gap={1}>
                <text fg={focus() === "files" ? theme.colors.primary : theme.colors.text}>文件</text>
                <For each={treeRows()}>
                  {(row, index) => (
                    <box
                      flexDirection="row"
                      backgroundColor={
                        index() === clampDiffTreeRowIndex(highlightedRowIndex(), treeRows())
                          ? focus() === "files"
                            ? theme.colors.primary
                            : theme.extended.bg.panel
                          : undefined
                      }
                      onMouseUp={() => {
                        setFocus("files");
                        setHighlightedRowIndex(index());
                        if (row.kind === "folder") {
                          toggleFolder(row.path);
                        } else {
                          highlightFile(row.fileIndex ?? 0);
                        }
                      }}
                    >
                      <text
                        fg={
                          index() === clampDiffTreeRowIndex(highlightedRowIndex(), treeRows()) && focus() === "files"
                            ? theme.colors.background
                            : theme.colors.muted
                        }
                        wrapMode="none"
                      >
                        {formatDiffTreeRowPrefix(treeRows(), index())}
                      </text>
                      <text
                        fg={
                          index() === clampDiffTreeRowIndex(highlightedRowIndex(), treeRows()) && focus() === "files"
                            ? theme.colors.background
                            : row.fileIndex === clampFileIndex(selectedIndex(), files())
                              ? theme.colors.primary
                              : isReviewed(row.path) || row.kind === "folder"
                                ? theme.colors.muted
                                : theme.colors.text
                        }
                        wrapMode="none"
                        flexGrow={1}
                      >
                        {row.name}
                      </text>
                      <text
                        fg={
                          index() === clampDiffTreeRowIndex(highlightedRowIndex(), treeRows()) && focus() === "files"
                            ? theme.colors.background
                            : theme.colors.muted
                        }
                        wrapMode="none"
                      >
                        {formatDiffTreeRowStatus(row, isReviewed(row.path))}
                      </text>
                    </box>
                  )}
                </For>
              </box>
            </box>
          </Show>
          <box
            flexGrow={1}
            overflow="hidden"
            paddingLeft={showFileTree() ? 1 : 0}
            border={focus() === "patches" ? ["left"] : undefined}
            borderColor={theme.extended.borderExt.active}
          >
            <Show when={selectedReviewed()}>
              <box paddingLeft={1} paddingBottom={1}>
                <text fg={theme.colors.success}>✓ 已审阅 · {selectedPath()}</text>
              </box>
            </Show>
            <scrollbox
              ref={(ref: any) => {
                patchScroll = ref;
              }}
              flexGrow={1}
              verticalScrollbarOptions={{ visible: false }}
              horizontalScrollbarOptions={{ visible: false }}
            >
              <DiffViewer diff={activeDiff()} filename={activeFilename()} showLineNumbers={true} view={view()} />
            </scrollbox>
          </box>
        </box>
      </Show>

      <Show when={showHelp()}>
        <box
          position="absolute"
          top={3}
          right={3}
          width={46}
          padding={1}
          border={true}
          borderColor={theme.colors.primary}
          backgroundColor={theme.extended.bg.panel}
        >
          <box flexDirection="column" gap={1}>
            <text fg={theme.colors.primary}>Diff 帮助</text>
            <text fg={theme.colors.muted}>q/Esc 关闭 · ? 帮助 · b 文件树</text>
            <text fg={theme.colors.muted}>n/p 或 ↑/↓ 切换文件</text>
            <text fg={theme.colors.muted}>PageUp/PageDown 翻页</text>
            <text fg={theme.colors.muted}>Tab 切换文件/补丁焦点 · Enter/Space 折叠目录</text>
            <text fg={theme.colors.muted}>←/→ 折叠/展开选中目录 · E 展开全部</text>
            <text fg={theme.colors.muted}>s 切换单个/全部补丁 · m 标记已审阅</text>
            <text fg={theme.colors.muted}>v 切换分屏/统一视图</text>
            <text fg={theme.colors.muted}>d 切换 diff 来源</text>
            <text fg={theme.colors.muted}>点击文件可定位到对应补丁</text>
          </box>
        </box>
      </Show>
    </box>
  );
}

export function PluginRouteMissing(props: { route: PluginRouteData }) {
  const route = useRoute();
  const theme = useTheme();

  useKeyboard((event) => {
    if (event.name === "q" || event.name === "escape") {
      route.navigate(getReturnRoute(props.route));
      event.stopPropagation();
    }
  });

  return (
    <box flexGrow={1} alignItems="center" justifyContent="center" backgroundColor={theme.colors.background}>
      <FeedbackPanel
        tone="warning"
        title="Plugin route 未注册"
        message={`id: ${props.route.id}`}
        hint={`该页面已进入插件路由，但当前没有对应渲染器。q/Esc 返回 ${props.route.returnRoute ? "来源页面" : "首页"}`}
        width={64}
      />
    </box>
  );
}
