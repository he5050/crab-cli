/**
 * 会话预览组件 — 显示会话列表中的会话详情预览。
 *
 * 职责:
 *   - 异步加载和缓存会话预览数据
 *   - 显示会话标题、模型、消息摘要
 *   - 预取会话预览提升切换体验
 *   - 实时更新会话状态(idle/busy/waiting/retry/completed/cancelled/error)
 *
 * 模块功能:
 *   - SessionPreview: 预览数据结构
 *   - SessionPreviewPane: 会话预览面板组件
 *   - loadSessionPreview: 加载会话预览(带缓存)
 *   - prefetchSessionPreviews: 预取会话预览
 *   - getSessionPreviewCacheKey: 生成缓存键
 *   - clearSessionPreviewCacheForTests: 测试用缓存清理
 *   - getSessionPreviewCacheSizeForTests: 测试用缓存大小查询
 *
 * 使用场景:
 *   - 会话切换器的会话预览展示
 *   - 会话列表快速浏览
 *
 * 边界:
 *   1. 仅负责 UI 展示，不负责会话创建/删除
 *   2. 预览数据异步加载，使用 Promise 缓存避免重复请求
 *   3. 依赖 session 模块获取会话数据
 *   4. diffSummary 来自 toolDiffRoute 模块
 *
 * 流程:
 *   1. 挂载时预取前 5 个会话预览
 *   2. 用户选择会话时异步加载预览
 *   3. 从缓存返回或构建新预览
 *   4. 订阅会话状态变更事件，实时更新状态标签
 *   5. 显示用户首条消息和助手最后回复
 */
import { type Accessor, Show, createMemo, createResource, createSignal, onCleanup, onMount } from "solid-js";
import type { SessionListItem, SessionStatus } from "@session";
import { extractPlainText, getSession, getSessionMessages, getSessionStatus, listSessions } from "@session";
import { useTheme } from "@/ui/contexts/theme";
import { Spinner } from "@/ui/components/spinner";
import { getOrBuildSessionDiffCacheEntry } from "@/ui/pages/session/components/toolDiffRoute";
import { useEventBus } from "@/ui/contexts/eventBus";
import { AppEvent } from "@bus";

export interface SessionPreview {
  id: string;
  title: string;
  model: string;
  projectDir: string;
  updatedAt: number;
  firstUser: string;
  latestAssistant: string;
  diffSummary?: { additions: number; deletions: number; files: number };
  messageCount: number;
}

const previewCache = new Map<string, Promise<SessionPreview>>();

export function getSessionPreviewCacheKey(session: Pick<SessionListItem, "id" | "updatedAt">): string {
  return `${session.id}:${session.updatedAt}`;
}

function truncate(text: string, length: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > length ? `${normalized.slice(0, length - 1)}…` : normalized;
}

function buildSessionPreview(item: SessionListItem): SessionPreview {
  const record = getSession(item.id);
  const messages = getSessionMessages(item.id);
  const firstUser = messages.find((msg) => msg.role === "user");
  const latestAssistant = [...messages].toReversed().find((msg) => msg.role === "assistant");

  return {
    diffSummary: getOrBuildSessionDiffCacheEntry({
      messages,
      sessionId: item.id,
      updatedAt: item.updatedAt,
    })?.summary,
    firstUser: firstUser ? truncate(extractPlainText(firstUser.parts), 180) : "暂无消息",
    id: item.id,
    latestAssistant: latestAssistant ? truncate(extractPlainText(latestAssistant.parts), 220) : "暂无消息",
    messageCount: item.messageCount,
    model: item.model ?? record?.model ?? "-",
    projectDir: record?.projectDir ?? process.cwd(),
    title: item.title,
    updatedAt: item.updatedAt,
  };
}

export function clearSessionPreviewCacheForTests(): void {
  previewCache.clear();
}

export function getSessionPreviewCacheSizeForTests(): number {
  return previewCache.size;
}

export function loadSessionPreview(item: SessionListItem): Promise<SessionPreview> {
  const key = getSessionPreviewCacheKey(item);
  const cached = previewCache.get(key);
  if (cached) {
    return cached;
  }

  const promise = Promise.resolve().then(() => buildSessionPreview(item));
  previewCache.set(key, promise);
  promise.catch(() => {
    previewCache.delete(key);
  });
  return promise;
}

export function prefetchSessionPreviews(items: readonly SessionListItem[]): void {
  for (const item of items.slice(0, 5)) {
    void loadSessionPreview(item).catch(() => {});
  }
}

export function SessionPreviewPane(props: { session: Accessor<SessionListItem | null> }) {
  const eventBus = useEventBus();
  const theme = useTheme();
  const [statusTick, setStatusTick] = createSignal(0);

  onMount(() => {
    prefetchSessionPreviews(listSessions().filter((item) => item));
  });

  const unlistenStatus = eventBus.subscribe(AppEvent.SessionStatusChanged, () => {
    setStatusTick((tick) => tick + 1);
  });
  onCleanup(unlistenStatus);

  const [preview] = createResource(
    () => {
      const session = props.session();
      if (!session) {
        return undefined;
      }
      return session;
    },
    async (session) => loadSessionPreview(session),
  );

  const currentPreview = createMemo(() => {
    const session = props.session();
    const data = preview();
    if (!session || !data) {
      return undefined;
    }
    if (data.id !== session.id || data.updatedAt !== session.updatedAt) {
      return undefined;
    }
    return data;
  });

  const loading = createMemo(() => Boolean(props.session()) && !currentPreview() && preview.loading);

  const statusLabel = createMemo(() => {
    const session = props.session();
    if (!session) {
      return undefined;
    }
    statusTick();
    const status = sessionStatus(session.id);
    if (status === "busy") {
      return { color: theme.colors.warning, text: "工作中" };
    }
    if (status === "waiting") {
      return { color: theme.colors.warning, text: "等待中" };
    }
    if (status === "retry") {
      return { color: theme.colors.warning, text: "重试中" };
    }
    if (status === "completed") {
      return { color: theme.colors.success, text: "已完成" };
    }
    if (status === "cancelled") {
      return { color: theme.colors.muted, text: "已取消" };
    }
    if (status === "error") {
      return { color: theme.colors.error, text: "错误" };
    }
    const persistedStatus = session.status;
    if (persistedStatus === "paused") {
      return { color: theme.colors.muted, text: "已暂停" };
    }
    if (persistedStatus === "completed") {
      return { color: theme.colors.success, text: "已完成" };
    }
    if (persistedStatus === "error") {
      return { color: theme.colors.error, text: "错误" };
    }
    return { color: theme.colors.muted, text: "空闲" };
  });

  return (
    <box
      flexDirection="column"
      paddingLeft={2}
      paddingRight={2}
      paddingTop={1}
      paddingBottom={1}
      gap={1}
      overflow="hidden"
    >
      <Show
        when={props.session()}
        fallback={
          <text fg={theme.colors.muted} wrapMode="word">
            未选择会话
          </text>
        }
      >
        {(session: Accessor<SessionListItem>) => (
          <>
            <Header session={session()} statusLabel={statusLabel()} />
            <Show when={loading()}>
              <Spinner label="正在加载预览..." color={theme.colors.muted} />
            </Show>
            <Show
              when={currentPreview()}
              fallback={
                <Show when={!loading()}>
                  <text fg={theme.colors.muted} wrapMode="word">
                    暂无消息
                  </text>
                </Show>
              }
            >
              {(data: Accessor<SessionPreview>) => <Exchange preview={data()} />}
            </Show>
          </>
        )}
      </Show>
    </box>
  );
}

function sessionStatus(sessionId: string): SessionStatus {
  const value = getSessionStatus(sessionId);
  return value;
}

function Header(props: { session: SessionListItem; statusLabel: { text: string; color: string } | undefined }) {
  const theme = useTheme();
  const c = theme.colors;
  const e = theme.extended;
  return (
    <box flexDirection="column" gap={0} flexShrink={0}>
      <text fg={c.text} wrapMode="none" overflow="hidden">
        {truncate(props.session.title, 40)}
      </text>
      <Show when={props.session.model}>
        <text fg={e.textMuted} wrapMode="none" overflow="hidden">
          {props.session.model}
        </text>
      </Show>
      <text fg={e.textMuted} wrapMode="none" overflow="hidden">
        <span style={{ fg: props.statusLabel?.color ?? c.muted }}>{props.statusLabel?.text ?? "空闲"}</span>
        <span>{` · ${relativeTime(props.session.updatedAt)}`}</span>
      </text>
      <Show when={props.session.messageCount > 0}>
        <text fg={e.textMuted} wrapMode="none" overflow="hidden">
          {props.session.messageCount} 条消息
        </text>
      </Show>
      <Show when={props.session.messageCount > 0}>
        <Show when={currentDiffSummary(props.session.id, props.session.updatedAt)}>
          {(diff: Accessor<{ additions: number; deletions: number; files: number }>) => <DiffRow diff={diff()} />}
        </Show>
      </Show>
    </box>
  );
}

function currentDiffSummary(sessionId: string, updatedAt: number) {
  return getOrBuildSessionDiffCacheEntry({
    messages: getSessionMessages(sessionId),
    sessionId,
    updatedAt,
  })?.summary;
}

function DiffRow(props: { diff: { additions: number; deletions: number; files: number } }) {
  const theme = useTheme();
  const e = theme.extended;
  if (!props.diff.additions && !props.diff.deletions) {
    return null;
  }
  return (
    <text wrapMode="none" overflow="hidden">
      <Show when={props.diff.additions > 0}>
        <span style={{ fg: e.diff.added }}>+{props.diff.additions}</span>
      </Show>
      <Show when={props.diff.additions > 0 && props.diff.deletions > 0}>
        <span> </span>
      </Show>
      <Show when={props.diff.deletions > 0}>
        <span style={{ fg: e.diff.removed }}>−{props.diff.deletions}</span>
      </Show>
    </text>
  );
}

function Exchange(props: { preview: SessionPreview }) {
  const theme = useTheme();
  const c = theme.colors;
  return (
    <box flexDirection="column" gap={1}>
      <text fg={c.muted} wrapMode="word">
        <span style={{ fg: c.muted }}>› </span>
        {props.preview.firstUser}
      </text>
      <text fg={c.text} wrapMode="word">
        {props.preview.latestAssistant}
      </text>
      <Show when={props.preview.diffSummary}>
        {(diff: Accessor<{ additions: number; deletions: number; files: number }>) => (
          <text fg={c.muted} wrapMode="word">
            {`${diff().files} 个文件 · +${diff().additions} -${diff().deletions}`}
          </text>
        )}
      </Show>
    </box>
  );
}

function relativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 0) {
    return "刚刚";
  }
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) {
    return "刚刚";
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes} 分钟前`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} 小时前`;
  }
  const days = Math.floor(hours / 24);
  if (days < 7) {
    return `${days} 天前`;
  }
  return new Date(timestamp).toLocaleDateString("zh-CN", { day: "numeric", month: "short" });
}
