/**
 * SessionListDialog / SessionSwitcher v2
 *
 * 职责:
 *   - 展示历史会话列表
 *   - 支持搜索过滤、时间分组、键盘导航
 *   - 提供恢复、删除、新建会话功能
 *
 * 模块功能:
 *   - 渲染会话列表(标题、模型、消息数、时间)和右侧 preview
 *   - 按时间分组(今天/昨天/本周/更早)
 *   - 搜索过滤(标题、ID、模型)
 *   - 键盘导航(上下箭头选择、Enter 恢复)
 *   - 快捷操作(D 删除、N 新建、Esc 关闭)
 *   - 视口滚动(固定显示 8 行)
 *
 * 使用场景:
 *   - 用户需要恢复历史会话时
 *   - 查看和管理所有历史会话时
 *   - 删除不需要的会话记录时
 *
 * 边界:
 *   1. 会话数据通过 listSessions 获取，组件管理本地状态
 *   2. 删除操作直接调用 deleteSession，不经过父组件
 *   3. 恢复和新建通过 props 回调通知外部
 *   4. 搜索过滤在组件内部完成
 *
 * 流程:
 *   1. 初始化加载会话列表
 *   2. 按时间分组并渲染列表
 *   3. 用户输入搜索关键词时实时过滤
 *   4. 键盘导航选择会话
 *   5. Enter 恢复会话，D 删除，N 新建
 *   6. 列表滚动时保持选中项在视口内
 */
import { For, Show, createMemo, createSignal, onCleanup } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { useKV } from "@/ui/contexts/kv";
import { useTheme } from "@/ui/contexts/theme";
import { DialogPrompt } from "@/ui/components/dialogPrompt";
import { Spinner } from "@/ui/components/spinner";
import {
  type MessagePart,
  type MessageRecord,
  type SessionListItem,
  deleteSession,
  getSessionStatus,
  listSessions,
  updateSession,
} from "@session";
import { createLogger } from "@/core/logging/logger";
import { useEventBus } from "@/ui/contexts/eventBus";
import { AppEvent } from "@bus";
import { buildSessionDiffCacheEntry } from "@/ui/pages/session/components/toolDiffRoute";
import {
  SESSION_SWITCHER_PINNED_KEY,
  normalizePinnedSessionIds,
  togglePinnedSessionId,
} from "@/ui/components/sessionSwitcherState";
import { SessionPreviewPane } from "@/ui/components/sessionSwitcherPreview";
import { iconSearch } from "@/ui/utils/icon";
import { symDot, symEmpty } from "@/core/icons/icon";

const log = createLogger("ui:session-list");

/** 时间分组标签 */
interface TimeGroup {
  label: string;
  sessions: SessionListItem[];
}

export function groupByTime(sessions: SessionListItem[]): TimeGroup[] {
  const oneDayMs = 86_400_000;
  const groups = new Map<string, SessionListItem[]>();

  const todayStart = new Date().setHours(0, 0, 0, 0);

  for (const s of sessions) {
    let label: string;
    if (s.updatedAt >= todayStart) {
      label = "today";
    } else if (s.updatedAt >= todayStart - oneDayMs) {
      label = "yesterday";
    } else if (s.updatedAt >= todayStart - oneDayMs * 7) {
      label = "this_week";
    } else {
      label = "earlier";
    }

    if (!groups.has(label)) {
      groups.set(label, []);
    }
    groups.get(label)!.push(s);
  }

  const order = ["today", "yesterday", "this_week", "earlier"];
  const result: TimeGroup[] = [];
  for (const key of order) {
    const items = groups.get(key);
    if (items && items.length > 0) {
      result.push({ label: key, sessions: items });
    }
  }
  return result;
}

function pad(t: string, w: number): string {
  return t + " ".repeat(Math.max(0, w - t.length));
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

function truncate(text: string, length: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > length ? `${normalized.slice(0, length - 1)}…` : normalized;
}

export function summarizeDiff(parts: MessagePart[]): string | undefined {
  const record: MessageRecord = {
    createdAt: 0,
    id: "preview-message",
    parts,
    role: "assistant",
    sessionId: "preview-session",
  };
  return buildSessionDiffCacheEntry({
    messages: [record],
    sessionId: record.sessionId,
  })?.summaryText;
}

export function SessionListDialog(props: { onSelect: (id: string) => void; onNew: () => void; onClose: () => void }) {
  const eventBus = useEventBus();
  const theme = useTheme();
  const kv = useKV();
  const c = theme.colors;

  const [query, setQuery] = createSignal("");
  const [selIdx, setSelIdx] = createSignal(0);
  const [sessions, setSessions] = createSignal<SessionListItem[]>(listSessions());
  const [renameTarget, setRenameTarget] = createSignal<SessionListItem | null>(null);
  const [deleteTarget, setDeleteTarget] = createSignal<string | null>(null);
  const [actionMessage, setActionMessage] = createSignal<string | null>(null);
  const [statusTick, setStatusTick] = createSignal(0);

  const unlistenStatus = eventBus.subscribe(AppEvent.SessionStatusChanged, () => {
    setStatusTick((tick) => tick + 1);
  });
  onCleanup(unlistenStatus);

  const sessionIds = () => sessions().map((session) => session.id);
  const pinnedIds = () => normalizePinnedSessionIds(kv.get(SESSION_SWITCHER_PINNED_KEY), sessionIds());
  const setPinnedIds = (ids: string[]) => {
    kv.set(SESSION_SWITCHER_PINNED_KEY, ids);
    setActionMessage(ids.length > 0 ? `已固定 ${ids.length} 个会话` : "已清空固定会话");
  };
  const isPinned = (id: string) => pinnedIds().includes(id);
  const runtimeStatus = (id: string) => {
    statusTick();
    return getSessionStatus(id);
  };

  const refresh = () => setSessions(listSessions());

  const filtered = createMemo(() => {
    const q = query().trim().toLowerCase();
    if (!q) {
      return sessions();
    }
    return sessions().filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q) ||
        (s.model ?? "").toLowerCase().includes(q),
    );
  });

  const groups = createMemo(() => {
    const pinned = new Set(pinnedIds());
    return groupByTime(filtered().filter((session) => !pinned.has(session.id)));
  });
  const pinnedGroups = createMemo(() => {
    const ids = pinnedIds();
    const map = new Map(sessions().map((session) => [session.id, session] as const));
    return ids.map((id) => map.get(id)).filter((session): session is SessionListItem => Boolean(session));
  });

  // 扁平化所有可见项(包括分组标题行)
  const flatItems = createMemo(() => {
    const items: ({ type: "group"; label: string } | { type: "session"; session: SessionListItem })[] = [];
    if (pinnedGroups().length > 0) {
      items.push({ label: "Pinned", type: "group" });
      for (const s of pinnedGroups()) {
        items.push({ session: s, type: "session" });
      }
    }
    for (const g of groups()) {
      items.push({ label: g.label, type: "group" });
      for (const s of g.sessions) {
        items.push({ session: s, type: "session" });
      }
    }
    return items;
  });

  const sessionItems = createMemo(() => flatItems().filter((i) => i.type === "session"));
  const selectedSession = createMemo(() => {
    const items = sessionItems();
    const idx = selIdx();
    if (idx < 0 || idx >= items.length) {
      return null;
    }
    return (items[idx] as { type: "session"; session: SessionListItem }).session;
  });

  const COL_TITLE = 24;
  const COL_MODEL = 10;
  const COL_COUNT = 7;

  useKeyboard((event) => {
    const n = event.name;

    if (n === "escape") {
      event.stopPropagation();
      props.onClose();
      return;
    }

    if (n === "backspace") {
      setQuery((q) => q.slice(0, -1));
      setSelIdx(0);
      return;
    }

    if (n === "up") {
      setSelIdx((i) => Math.max(0, i - 1));
      return;
    }

    if (n === "down") {
      setSelIdx((i) => Math.min(sessionItems().length - 1, i + 1));
      return;
    }

    if (n === "return" || n === "enter") {
      const s = selectedSession();
      if (s) {
        event.stopPropagation();
        log.info(`恢复会话: ${s.id}`);
        props.onSelect(s.id);
      }
      return;
    }

    if ((event.ctrl && n === "d") || n === "delete") {
      const s = selectedSession();
      if (s) {
        event.stopPropagation();
        if (deleteTarget() === s.id) {
          const ok = deleteSession(s.id);
          if (ok) {
            setDeleteTarget(null);
            setActionMessage(`已删除会话: ${s.title}`);
            refresh();
            setSelIdx((i) => Math.max(0, Math.min(sessionItems().length - 1, i)));
          } else {
            setActionMessage(`删除失败: ${s.title}`);
          }
          return;
        }
        setDeleteTarget(s.id);
        setActionMessage(`再次按 Ctrl+D 确认删除: ${s.title}`);
      }
      return;
    }

    if (event.ctrl && n === "r") {
      const s = selectedSession();
      if (s) {
        event.stopPropagation();
        setRenameTarget(s);
      }
      return;
    }

    if (event.ctrl && n === "f") {
      const s = selectedSession();
      if (s) {
        event.stopPropagation();
        const next = togglePinnedSessionId(kv.get(SESSION_SWITCHER_PINNED_KEY), s.id, sessionIds());
        setPinnedIds(next);
        setActionMessage(next.includes(s.id) ? `已固定会话: ${s.title}` : `已取消固定: ${s.title}`);
        refresh();
      }
      return;
    }

    if (n === "n") {
      event.stopPropagation();
      props.onNew();
      return;
    }

    // 搜索输入
    if (n && n.length === 1 && !event.ctrl && !event.meta) {
      setQuery((q) => q + n);
      setSelIdx(0);
    }
  });

  // 计算选中项在 flatItems 中的位置
  const selectedFlatIdx = createMemo(() => {
    const sel = selectedSession();
    if (!sel) {
      return -1;
    }
    let sessionCount = 0;
    for (let i = 0; i < flatItems().length; i++) {
      const item = flatItems()[i]!;
      if (item.type === "session") {
        if ((item as { type: "session"; session: SessionListItem }).session.id === sel.id) {
          return i;
        }
        sessionCount++;
      }
    }
    return -1;
  });

  // 视口(固定显示 12 行内容)
  const VIEW_H = 12;
  const viewStart = createMemo(() => {
    const sel = selectedFlatIdx();
    const total = flatItems().length;
    if (total <= VIEW_H) {
      return 0;
    }
    const half = Math.floor(VIEW_H / 2);
    let s = sel - half;
    if (s < 0) {
      s = 0;
    }
    if (s + VIEW_H > total) {
      s = total - VIEW_H;
    }
    return s;
  });

  const visible = createMemo(() => flatItems().slice(viewStart(), viewStart() + VIEW_H));
  const renameValue = () => renameTarget()?.title ?? "";

  const confirmRename = (value: string) => {
    const target = renameTarget();
    if (!target) {
      return;
    }
    const nextTitle = value.trim();
    if (!nextTitle) {
      setActionMessage("会话标题不能为空");
      return;
    }
    const result = updateSession(target.id, { title: nextTitle });
    if (result) {
      setActionMessage(`已重命名为: ${result.title}`);
      refresh();
    } else {
      setActionMessage("重命名失败");
    }
    setRenameTarget(null);
  };

  return (
    <box flexDirection="column" borderStyle="double" borderColor={c.primary} padding={1} width={96}>
      <Show when={renameTarget()}>
        <DialogPrompt
          title="重命名会话"
          value={renameValue()}
          description="输入新的会话标题"
          confirmLabel="重命名"
          cancelLabel="取消"
          onConfirm={confirmRename}
          onCancel={() => setRenameTarget(null)}
        />
      </Show>
      <text>
        <span style={{ bold: true, fg: c.primary }}>{"会话切换器"}</span>
      </text>
      <box height={1} />

      <box flexDirection="row">
        <text>
          <span style={{ fg: c.accent }}>{`${iconSearch} `}</span>
          <span style={{ fg: c.text }}>{query()}</span>
          <span style={{ fg: c.accent }}>{"▎"}</span>
          <Show when={!query()}>
            <span style={{ fg: c.muted }}>{"搜索会话..."}</span>
          </Show>
        </text>
      </box>
      <Show when={actionMessage()}>
        <box height={1}>
          <text fg={c.muted}>{actionMessage()}</text>
        </box>
      </Show>
      <box height={1}>
        <text fg={c.border}>{"─".repeat(88)}</text>
      </box>

      <box flexDirection="row" height={VIEW_H + 3}>
        {/* 左侧会话列表 */}
        <box flexDirection="column" width={48} paddingRight={1}>
          <text fg={c.muted}>
            {`  ${pad("标题", COL_TITLE)}${pad("模型", COL_MODEL)}${pad("消息", COL_COUNT)}更新时间`}
          </text>
          <box height={1} />
          <box flexDirection="column" height={VIEW_H}>
            <Show
              when={filtered().length === 0}
              fallback={
                <For each={visible()}>
                  {(item) => {
                    if (item.type === "group") {
                      return <text fg={c.muted}>{`── ${(item as { type: "group"; label: string }).label} ──`}</text>;
                    }

                    const s = (item as { type: "session"; session: SessionListItem }).session;
                    let isSel = false;
                    const items = sessionItems();
                    for (let i = 0; i < items.length; i++) {
                      if (
                        (items[i] as { type: "session"; session: SessionListItem }).session.id === s.id &&
                        i === selIdx()
                      ) {
                        isSel = true;
                        break;
                      }
                    }

                    const slot = pinnedIds().indexOf(s.id) + 1;
                    const status = runtimeStatus(s.id);
                    const isWorking = status === "busy" || status === "waiting" || status === "retry";
                    const title = deleteTarget() === s.id ? "再次按 Ctrl+D 确认删除" : s.title;
                    const statusIcon =
                      slot > 0
                        ? String(slot)
                        : status === "error"
                          ? "!"
                          : status === "completed"
                            ? "✓"
                            : status === "cancelled"
                              ? "○"
                              : s.status === "paused"
                                ? "○"
                                : s.status === "completed"
                                  ? "✓"
                                  : s.status === "active"
                                    ? symDot
                                    : s.status === "error"
                                      ? "×"
                                      : symEmpty;
                    const fg = isSel ? c.success : isPinned(s.id) ? c.warning : c.text;

                    return (
                      <box flexDirection="row" height={1}>
                        <text>
                          <span style={{ fg: isSel ? c.success : undefined }}>{isSel ? "▸ " : "  "}</span>
                        </text>
                        <box width={2}>
                          <Show
                            when={isWorking}
                            fallback={<text fg={status === "error" ? c.error : fg}>{`${statusIcon} `}</text>}
                          >
                            <Spinner color={c.warning} />
                          </Show>
                        </box>
                        <text>
                          <span
                            style={{
                              fg:
                                deleteTarget() === s.id
                                  ? c.error
                                  : isSel
                                    ? c.success
                                    : isPinned(s.id)
                                      ? c.warning
                                      : c.text,
                            }}
                          >
                            {pad(truncate(title, COL_TITLE - 1), COL_TITLE)}
                          </span>
                          <span style={{ fg: c.muted }}>{pad(truncate(s.model ?? "-", COL_MODEL - 1), COL_MODEL)}</span>
                          <span style={{ fg: c.muted }}>{pad(String(s.messageCount), COL_COUNT)}</span>
                          <span style={{ fg: c.muted }}>{fmtTime(s.updatedAt)}</span>
                        </text>
                      </box>
                    );
                  }}
                </For>
              }
            >
              <text fg={c.muted}> 暂无会话记录</text>
            </Show>
          </box>
        </box>

        <box width={1} flexDirection="column">
          <text fg={c.border}>{"│"}</text>
          <For each={Array.from({ length: VIEW_H + 2 })}>{() => <text fg={c.border}>{"│"}</text>}</For>
        </box>

        {/* 右侧预览 */}
        <box flexDirection="column" paddingLeft={2} width={42}>
          <text fg={c.muted}>预览</text>
          <box height={1} />
          <SessionPreviewPane session={selectedSession} />
        </box>
      </box>

      <box height={1}>
        <text fg={c.border}>{"─".repeat(88)}</text>
      </box>

      {/* 底栏 */}
      <text fg={c.muted}>
        <span style={{ fg: c.text }}>{"↑↓"}</span>
        {" 选择 "}
        <span style={{ fg: c.text }}>{"Enter"}</span>
        {" 恢复 "}
        <span style={{ fg: c.text }}>{"Ctrl+R"}</span>
        {" 重命名 "}
        <span style={{ fg: c.text }}>{"Ctrl+F"}</span>
        {" 置顶 "}
        <span style={{ fg: c.text }}>{"Ctrl+D"}</span>
        {" 删除 "}
        <span style={{ fg: c.text }}>{"N"}</span>
        {" 新建 "}
        <span style={{ fg: c.text }}>{"Esc"}</span>
        {" 关闭 "}
        <span style={{ fg: c.text }}>{"1-9"}</span>
        {" slots"}
      </text>
    </box>
  );
}
