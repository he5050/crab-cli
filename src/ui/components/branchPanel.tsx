/**
 * BranchPanel
 *
 * 职责:
 *   - 管理 Git 分支列表展示和操作
 *   - 支持分支切换、创建、删除、刷新
 *   - 提供搜索过滤功能
 *
 * 模块功能:
 *   - 渲染分支列表(本地/远程)
 *   - 显示分支状态(当前分支、ahead/behind)
 *   - 键盘导航(上下箭头、回车切换)
 *   - 快捷操作(n 新建、d 删除、r 刷新)
 *   - 实时搜索过滤
 *
 * 使用场景:
 *   - 用户需要查看和切换 Git 分支时
 *   - 需要创建新分支时
 *   - 需要删除或刷新分支列表时
 *
 * 边界:
 *   1. 分支数据通过 props 传入，组件不管理 Git 操作
 *   2. 所有 Git 操作通过回调函数通知父组件处理
 *   3. 当前分支不可删除
 *   4. 远程分支切换逻辑由父组件决定
 *
 * 流程:
 *   1. 接收分支列表数据
 *   2. 渲染分支列表，标记当前分支
 *   3. 支持键盘导航和快捷操作
 *   4. 用户输入时实时过滤分支
 *   5. 操作后通过回调通知父组件处理
 */
import { For, Show, createMemo, createSignal } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { useTheme } from "@/ui/contexts/theme";
import { actionSelect, iconIdle, iconRunning } from "@/ui/utils/icon";

export interface BranchInfo {
  name: string;
  isCurrent: boolean;
  isRemote: boolean;
  upstream?: string;
  lastCommit?: { hash: string; message: string; author: string; date: string };
  aheadBehind?: { ahead: number; behind: number };
}

export interface BranchPanelProps {
  branches: BranchInfo[];
  selectedBranch?: string;
  onSwitchBranch?: (name: string) => void;
  onCreateBranch?: (name: string, base?: string) => void;
  onDeleteBranch?: (name: string) => void;
  onMergeBranch?: (name: string) => void;
  onRefresh?: () => void;
  onClose?: () => void;
}

export function BranchPanel(props: BranchPanelProps) {
  const theme = useTheme();
  const c = theme.colors;
  const [focusIndex, setFocusIndex] = createSignal(0);
  const [filter, setFilter] = createSignal("");
  const [showCreateInput, setShowCreateInput] = createSignal(false);
  const [newBranchName, setNewBranchName] = createSignal("");

  const filteredBranches = createMemo(() => {
    let list = props.branches;
    if (filter()) {
      const f = filter().toLowerCase();
      list = list.filter((b) => b.name.toLowerCase().includes(f));
    }
    return list.toSorted((a, b) => {
      if (a.isCurrent) {
        return -1;
      }
      if (b.isCurrent) {
        return 1;
      }
      return a.name.localeCompare(b.name);
    });
  });

  const localCount = () => props.branches.filter((b) => !b.isRemote).length;
  const remoteCount = () => props.branches.filter((b) => b.isRemote).length;

  useKeyboard((event) => {
    if (showCreateInput()) {
      if (event.name === "escape") {
        setShowCreateInput(false);
        setNewBranchName("");
        return;
      }
      if (event.name === "return" || event.name === "enter") {
        const name = newBranchName().trim();
        if (name) {
          props.onCreateBranch?.(name);
          setNewBranchName("");
          setShowCreateInput(false);
        }
        return;
      }
      if (event.name === "backspace") {
        setNewBranchName((v) => v.slice(0, -1));
        return;
      }
      if (event.name && event.name.length === 1 && !event.ctrl && !event.meta) {
        setNewBranchName((v) => v + event.name);
        return;
      }
      return;
    }

    if (event.name === "escape") {
      props.onClose?.();
      return;
    }
    if (event.name === "up") {
      setFocusIndex((i) => Math.max(0, i - 1));
      return;
    }
    if (event.name === "down") {
      setFocusIndex((i) => Math.min(filteredBranches().length - 1, i + 1));
      return;
    }
    if (event.name === "return" || event.name === "enter") {
      const branch = filteredBranches()[focusIndex()];
      if (branch && !branch.isCurrent && !branch.isRemote) {
        props.onSwitchBranch?.(branch.name);
      }
      return;
    }
    if (event.name === "n") {
      setShowCreateInput(true);
      return;
    }
    if (event.name === "d") {
      const branch = filteredBranches()[focusIndex()];
      if (branch && !branch.isCurrent) {
        props.onDeleteBranch?.(branch.name);
      }
      return;
    }
    if (event.name === "r") {
      props.onRefresh?.();
      return;
    }
    // 搜索过滤
    if (event.name === "backspace") {
      setFilter((f) => f.slice(0, -1));
      setFocusIndex(0);
      return;
    }
    if (event.name && event.name.length === 1 && !event.ctrl && !event.meta) {
      setFilter((f) => f + event.name);
      setFocusIndex(0);
    }
  });

  const maxVisible = 10;
  const displayWindow = createMemo(() => {
    const items = filteredBranches();
    const sel = focusIndex();
    if (items.length <= maxVisible) {
      return { items, start: 0 };
    }
    let start = Math.max(0, sel - Math.floor(maxVisible / 2));
    const end = Math.min(items.length, start + maxVisible);
    if (end - start < maxVisible) {
      start = Math.max(0, end - maxVisible);
    }
    return { items: items.slice(start, end), start };
  });

  return (
    <box flexDirection="column" paddingLeft={2} paddingRight={2} gap={1}>
      {/* 标题 */}
      <box flexDirection="row" justifyContent="space-between">
        <text fg={c.text}>
          <b>{"🌿 分支管理"}</b>
          <span style={{ fg: c.muted }}>{` (${localCount()} 本地, ${remoteCount()} 远程)`}</span>
        </text>
        <text fg={c.muted}>{"esc 返回"}</text>
      </box>

      {/* 创建输入 */}
      <Show when={showCreateInput()}>
        <box flexDirection="row" gap={1}>
          <text fg={c.info}>{"新分支:"}</text>
          <text fg={c.accent}>{`${actionSelect} ${newBranchName()}_`}</text>
        </box>
      </Show>

      {/* 搜索提示 */}
      <Show when={!showCreateInput() && filter()}>
        <text fg={c.info}>{`搜索: ${filter()}`}</text>
      </Show>

      {/* 分支列表 */}
      <Show when={filteredBranches().length === 0}>
        <text fg={c.muted}>{"暂无分支"}</text>
      </Show>

      <box flexDirection="column">
        <For each={displayWindow().items}>
          {(branch, index) => {
            const originalIndex = () => displayWindow().start + index();
            const isFocused = () => originalIndex() === focusIndex();
            const icon = branch.isCurrent ? iconRunning : branch.isRemote ? iconIdle : iconIdle;
            const iconFg = branch.isCurrent ? c.success : c.muted;

            return (
              <box
                flexDirection="row"
                gap={1}
                paddingLeft={1}
                paddingRight={1}
                backgroundColor={isFocused() ? c.primary : undefined}
                {...({} as any)}
              >
                <text fg={iconFg} flexShrink={0}>
                  {icon}
                </text>
                <text fg={branch.isCurrent ? c.success : isFocused() ? c.text : c.text} flexGrow={1}>
                  {branch.isCurrent ? <b>{branch.name}</b> : branch.name}
                </text>
                <Show when={branch.isRemote}>
                  <text fg={c.muted} flexShrink={0}>
                    {"(远程)"}
                  </text>
                </Show>
                <Show when={branch.aheadBehind && (branch.aheadBehind!.ahead > 0 || branch.aheadBehind!.behind > 0)}>
                  <text fg={c.warning} flexShrink={0}>
                    {`↑${branch.aheadBehind!.ahead} ↓${branch.aheadBehind!.behind}`}
                  </text>
                </Show>
              </box>
            );
          }}
        </For>
      </box>

      {/* 提示 */}
      <text fg={c.muted}>{"↑↓ 导航 · Enter 切换 · n 新建 · d 删除 · r 刷新 · 直接输入搜索"}</text>
    </box>
  );
}
