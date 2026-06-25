/**
 * 侧边栏组件 — 提供会话右侧栏的标题、内容、底部插槽
 *
 * 职责:
 *   - 提供会话右侧栏的标题、内容、底部插槽
 *   - 按顺序组织上下文 / MCP / LSP / 待办 / 已修改文件 / 任务
 *   - 支持待办 / MCP / 文件区块的折叠与数量反馈
 *
 * 模块功能:
 *   - LspDiagnosticItem: LSP 诊断项类型
 *   - SidebarMcpServer: MCP 服务器状态类型
 *   - ContextStats: 上下文统计类型
 *   - SidebarModifiedFile: 修改文件类型
 *   - hasUsableProviderConnection: 检查是否有可用 provider
 *   - shouldShowGettingStartedCard: 检查是否显示入门卡片
 *   - buildModifiedFilesFromMessages: 从消息构建修改文件列表
 *   - SidebarPanel: 侧边栏主组件
 *
 * 使用场景:
 *   - 会话页面侧边信息展示
 *   - MCP 服务器状态显示
 *   - LSP 诊断信息展示
 *   - Todo 列表显示
 *   - 修改文件统计
 *
 * 边界:
 * 1. 顺序组织各个区块
 * 2. Context 区块依赖 agentInfo 和 contextStats
 * 3. 已修改文件区块从消息中解析 diff 信息
 *
 * 流程:
 * 1. 暂无(这是 UI 组件，无特定执行流程)
 */
import { For, type JSX, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { readFileSync } from "node:fs";
import { useEventBus } from "@/ui/contexts/eventBus";
import { AppEvent } from "@bus";
import { VERSION } from "@/config/version";
import {
  BORDER_SUBTLE,
  SIDEBAR_WIDTH,
  SURFACE_PANEL,
  TEXT_BOLD,
  TEXT_MUTED,
  TEXT_PRIMARY,
} from "@/ui/themes/sessionTokens";
import { clearSidebarSections, getSidebarSections, registerSidebarSection } from "./sidebarRegistry";
import type { AgentInfo } from "@agent";
import { getModeMeta } from "@/agent/prompt/modes";
import type { ChatMode } from "@/agent/prompt/modes";
import type { ChatMessage } from "@/ui/contexts/chat";
import type { ExtendedThemeColors, ThemeColors } from "@/ui/contexts/theme";
import type { AppConfigSchema } from "@/schema/config";
import { SidebarSlot } from "@/ui/plugins/slots";
import { parseDiffFiles } from "@/ui/pages/pluginDiffModel";
import { getToolDiff } from "@/ui/pages/session/components/tools/toolRenderSpec";
import { useRoute } from "@/ui/contexts/route";
import { type SessionTodoItem, sortSessionTodos, summarizeTodos } from "@/ui/pages/session/components/sidebarTodos";
import {
  getCurrentWorkspace,
  getWorkspaceDisplay,
  listWorkspaces,
  switchWorkspace,
} from "@/config/workspace/workspaceManager";
import type { WorkspaceConfig } from "@/schema/config";
import {
  actionBullet,
  actionClose,
  actionCollapse,
  actionExpand,
  iconError,
  iconIdle,
  iconLoading,
  iconRunning,
  iconSuccess,
  iconWarning,
} from "@/ui/utils/icon";
import { symArrowRight } from "@/core/icons/icon";
import { checkboxIcon } from "@/core/icons/iconDerived";

interface TaskItem {
  id: string;
  label: string;
  status: "pending" | "running" | "done" | "error";
}

export interface LspDiagnosticItem {
  file: string;
  line: number;
  severity: "error" | "warning" | "info" | "hint";
  message: string;
}

interface SidebarMcpServer {
  name: string;
  state: "connected" | "connecting" | "disconnected" | "error" | "disabled";
  toolCount: number;
  type?: "stdio" | "sse" | "http";
  enabled?: boolean;
  source?: "global" | "project";
  configPath?: string;
  error?: string;
  authStatus?: "unsupported" | "not_authenticated" | "authenticated" | "expired";
}

export interface ContextStats {
  instructionFiles: number;
  toolCount: number;
  ruleCount: number;
  estimatedTokens?: number;
}

export interface SidebarModifiedFile {
  file: string;
  additions: number;
  deletions: number;
}

function taskIcon(status: TaskItem["status"]): string {
  switch (status) {
    case "done": {
      return iconSuccess;
    }
    case "running": {
      return iconRunning;
    }
    case "error": {
      return iconError;
    }
    case "pending": {
      return iconIdle;
    }
  }
}

function taskStatusColor(status: TaskItem["status"], colors: ThemeColors): string {
  switch (status) {
    case "done": {
      return colors.success;
    }
    case "running": {
      return colors.primary;
    }
    case "error": {
      return colors.error;
    }
    case "pending": {
      return colors.muted;
    }
  }
}

function agentStatusIcon(status: string): string {
  switch (status) {
    case "thinking": {
      return iconLoading;
    }
    case "running": {
      return actionExpand;
    }
    case "completed": {
      return iconSuccess;
    }
    case "error": {
      return iconError;
    }
    default: {
      return iconRunning;
    }
  }
}

function agentStatusColor(status: string, colors: ThemeColors): string {
  switch (status) {
    case "thinking": {
      return colors.warning;
    }
    case "running": {
      return colors.primary;
    }
    case "completed": {
      return colors.success;
    }
    case "error": {
      return colors.error;
    }
    default: {
      return colors.muted;
    }
  }
}

function diagIcon(severity: LspDiagnosticItem["severity"]): string {
  switch (severity) {
    case "error": {
      return iconError;
    }
    case "warning": {
      return iconWarning;
    }
    case "info": {
      return "ℹ";
    }
    case "hint": {
      return symArrowRight;
    }
  }
}

function diagColor(severity: LspDiagnosticItem["severity"], colors: ThemeColors): string {
  switch (severity) {
    case "error": {
      return colors.error;
    }
    case "warning": {
      return colors.warning;
    }
    case "info": {
      return colors.text;
    }
    case "hint": {
      return colors.muted;
    }
  }
}

function todoIcon(status: SessionTodoItem["status"]): string {
  if (status === "completed") {
    return checkboxIcon(true);
  }
  if (status === "in_progress") {
    return checkboxIcon(true);
  }
  return "[ ]";
}

function todoColor(status: SessionTodoItem["status"], colors: ThemeColors): string {
  if (status === "in_progress") {
    return colors.warning;
  }
  return colors.muted;
}

function todoDepth(todo: SessionTodoItem, todos: SessionTodoItem[]): number {
  const byId = new Map(todos.map((item) => [item.id, item]));
  let depth = 0;
  let current = todo;
  const seen = new Set<string>();
  while (current.parentId && !seen.has(current.id)) {
    seen.add(current.id);
    const parent = byId.get(current.parentId);
    if (!parent) {
      break;
    }
    depth += 1;
    current = parent;
  }
  return depth;
}

function readableSidebarColors(colors: ThemeColors) {
  return {
    ...colors,
    border: BORDER_SUBTLE,
    muted: TEXT_MUTED,
    text: TEXT_PRIMARY,
  };
}

function sidebarPanelColor(extended?: ExtendedThemeColors) {
  return extended?.bg.panel ?? SURFACE_PANEL;
}

function useOptionalRoute() {
  try {
    return useRoute();
  } catch {
    return undefined;
  }
}

export function hasUsableProviderConnection(config?: AppConfigSchema): boolean {
  return Object.values(config?.providerConfig ?? {}).some(
    (provider) => Boolean(provider.apiKey) || Boolean(provider.baseURL),
  );
}

export function shouldShowGettingStartedCard(config?: AppConfigSchema): boolean {
  return !hasUsableProviderConnection(config);
}

function shortCwd(): string {
  const cwd = process.cwd().replace(/\/+$/, "");
  const home = process.env.HOME ?? "";
  if (home && cwd.startsWith(home)) {
    return `~${cwd.slice(home.length)}`;
  }
  return cwd;
}

function gitBranch(): string | undefined {
  try {
    const head = readFileSync(`${process.cwd()}/.git/HEAD`, "utf8").trim();
    if (head.startsWith("ref: ")) {
      return head.slice(head.lastIndexOf("/") + 1);
    }
    return head.slice(0, 12);
  } catch {
    return undefined;
  }
}

function SidebarSection(props: { title: string; colors: ThemeColors; children: JSX.Element }) {
  return (
    <box flexDirection="column" marginBottom={1}>
      <text>
        <span style={{ bold: true, fg: TEXT_BOLD }}>{props.title}</span>
      </text>
      <box paddingLeft={1} flexDirection="column" gap={1}>
        {props.children}
      </box>
    </box>
  );
}

function SidebarCollapsibleSection(props: {
  title: string;
  summary?: string;
  count: number;
  colors: ThemeColors;
  openByDefault?: boolean;
  children: JSX.Element;
}) {
  const [open, setOpen] = createSignal(props.openByDefault ?? true);
  const canToggle = () => props.count > 2;
  const toggle = () => {
    if (canToggle()) {
      setOpen((value) => !value);
    }
  };

  return (
    <box flexDirection="column" marginBottom={1}>
      <box flexDirection="row" gap={1} onMouseDown={toggle}>
        <Show when={canToggle()}>
          <text fg={props.colors.text}>{open() ? actionCollapse : actionExpand}</text>
        </Show>
        <text fg={props.colors.text}>
          <b>{props.title}</b>
          <Show when={props.summary && !open()}>
            <span style={{ fg: props.colors.muted }}> {props.summary}</span>
          </Show>
        </text>
      </box>
      <Show when={!canToggle() || open()}>
        <box paddingLeft={1} flexDirection="column" gap={1}>
          {props.children}
        </box>
      </Show>
    </box>
  );
}

export function buildModifiedFilesFromMessages(messages: ChatMessage[]): SidebarModifiedFile[] {
  const files = new Map<string, SidebarModifiedFile>();

  for (const message of messages) {
    for (const part of message.parts ?? []) {
      if (part.type !== "tool") {
        continue;
      }
      const diff = getToolDiff(part);
      if (!diff?.trim()) {
        continue;
      }
      for (const entry of parseDiffFiles(diff)) {
        const path = entry.path || entry.oldPath || "patch";
        const current = files.get(path) ?? { additions: 0, deletions: 0, file: path };
        current.additions += entry.additions;
        current.deletions += entry.deletions;
        files.set(path, current);
      }
    }
  }

  return [...files.values()];
}

function SidebarContextSection(props: {
  colors: ThemeColors;
  agentInfo?: AgentInfo;
  agentStatus?: string;
  mode?: string;
  yoloOverlay?: boolean;
  contextStats?: ContextStats;
}) {
  const status = () => props.agentStatus ?? "idle";
  const modeMeta = createMemo(() => getModeMeta((props.yoloOverlay ? "yolo" : (props.mode ?? "chat")) as ChatMode));

  return (
    <SidebarSection title="上下文" colors={props.colors}>
      <box flexDirection="column" gap={1}>
        <text fg={props.colors.text}>
          <span style={{ fg: props.colors.accent }}>{modeMeta().icon} </span>
          <span style={{ bold: true, fg: props.colors.text }}>{modeMeta().label}</span>
          <Show when={props.yoloOverlay && props.mode !== "yolo"}>
            <span style={{ fg: props.colors.warning }}> +YOLO</span>
          </Show>
        </text>
        <text fg={props.colors.muted}>{modeMeta().description}</text>

        <Show when={props.agentInfo} fallback={<text fg={props.colors.muted}>默认 general</text>}>
          <box flexDirection="column" gap={1}>
            <text fg={agentStatusColor(status(), props.colors)}>
              {agentStatusIcon(status())} {props.agentInfo!.label}
            </text>
            <text fg={props.colors.muted}>{props.agentInfo!.description}</text>
            <Show when={status() === "thinking" || status() === "running"}>
              <text fg={props.colors.warning}>运行中...</text>
            </Show>
          </box>
        </Show>

        <Show when={props.contextStats}>
          <box flexDirection="column" gap={1}>
            <text fg={props.colors.muted}>
              指令文件 <span style={{ fg: props.colors.text }}>{props.contextStats!.instructionFiles}</span>
            </text>
            <text fg={props.colors.muted}>
              工具数 <span style={{ fg: props.colors.text }}>{props.contextStats!.toolCount}</span>
            </text>
            <text fg={props.colors.muted}>
              规则数 <span style={{ fg: props.colors.text }}>{props.contextStats!.ruleCount}</span>
            </text>
            <Show when={props.contextStats!.estimatedTokens !== undefined}>
              <text fg={props.colors.muted}>
                Token <span style={{ fg: props.colors.text }}>~{props.contextStats!.estimatedTokens}</span>
              </text>
            </Show>
          </box>
        </Show>
      </box>
    </SidebarSection>
  );
}

function SidebarMcpSlot(props: { colors: ThemeColors }) {
  const eventBus = useEventBus();
  const [servers, setServers] = createSignal<SidebarMcpServer[]>([]);

  const unsub = eventBus.subscribe(AppEvent.McpStatusUpdated, (evt) => {
    setServers([...(evt.properties.servers ?? []), ...(evt.properties.builtinGroups ?? [])]);
  });
  onCleanup(() => unsub());

  const list = createMemo(() => servers());
  const activeCount = createMemo(() => list().filter((item) => item.state === "connected").length);
  const errorCount = createMemo(
    () =>
      list().filter(
        (item) => item.state === "error" || item.authStatus === "expired" || item.authStatus === "not_authenticated",
      ).length,
  );

  const dotColor = (state: SidebarMcpServer["state"]) => {
    if (state === "connected") {
      return props.colors.success;
    }
    if (state === "error") {
      return props.colors.error;
    }
    if (state === "disabled" || state === "disconnected") {
      return props.colors.muted;
    }
    return props.colors.warning;
  };

  return (
    <Show when={list().length > 0}>
      <SidebarCollapsibleSection
        title="MCP"
        summary={`(${activeCount()} 个已连接${errorCount() > 0 ? `，${errorCount()} 个异常` : ""})`}
        count={list().length}
        colors={props.colors}
      >
        <For each={list()}>
          {(item) => (
            <box flexDirection="row" gap={1}>
              <text fg={dotColor(item.state)} flexShrink={0}>
                {actionBullet}
              </text>
              <text fg={props.colors.text} wrapMode="word">
                {item.name}{" "}
                <span style={{ fg: props.colors.muted }}>
                  <Show when={item.state === "connected"}>已连接</Show>
                  <Show when={item.state === "connecting"}>连接中</Show>
                  <Show when={item.state === "disconnected"}>已断开</Show>
                  <Show when={item.state === "disabled"}>已禁用</Show>
                  <Show when={item.state === "error"}>
                    <i>{item.error ?? "错误"}</i>
                  </Show>
                </span>
              </text>
            </box>
          )}
        </For>
      </SidebarCollapsibleSection>
    </Show>
  );
}

function SidebarLspSlot(props: { colors: ThemeColors; lspDiagnostics?: LspDiagnosticItem[] }) {
  const list = createMemo(() => props.lspDiagnostics ?? []);

  return (
    <Show
      when={list().length > 0}
      fallback={
        <SidebarSection title="LSP" colors={props.colors}>
          <text fg={props.colors.muted}>读取文件后将自动激活 LSP</text>
        </SidebarSection>
      }
    >
      <SidebarCollapsibleSection title="LSP" summary={`(${list().length})`} count={list().length} colors={props.colors}>
        <For each={list().slice(0, 6)}>
          {(diag) => (
            <box flexDirection="row" gap={1}>
              <text fg={diagColor(diag.severity, props.colors)} flexShrink={0}>
                {diagIcon(diag.severity)} {diag.file.split("/").pop()}:{diag.line}
              </text>
              <text fg={props.colors.muted} wrapMode="word">
                {diag.message}
              </text>
            </box>
          )}
        </For>
        <Show when={list().length > 6}>
          <text fg={props.colors.muted}>... 还有 {list().length - 6} 项</text>
        </Show>
      </SidebarCollapsibleSection>
    </Show>
  );
}

function SidebarTodoSlot(props: { todos: SessionTodoItem[]; colors: ThemeColors; onOpen?: () => void }) {
  const sorted = createMemo(() => sortSessionTodos(props.todos));
  const summary = createMemo(() => summarizeTodos(sorted()));

  return (
    <Show when={summary().active > 0}>
      <SidebarCollapsibleSection
        title="待办"
        summary={`(${summary().active} 个进行中 / 共 ${summary().total} 个)`}
        count={sorted().length}
        colors={props.colors}
      >
        <For each={sorted()}>
          {(todo) => (
            <box flexDirection="row" gap={1} onMouseDown={() => props.onOpen?.()}>
              <text fg={todoColor(todo.status, props.colors)} flexShrink={0}>
                {"  ".repeat(todoDepth(todo, sorted()))}
                {todo.parentId ? "└─ " : ""}
                {todoIcon(todo.status)}
              </text>
              <text fg={todoColor(todo.status, props.colors)} wrapMode="word">
                {todo.content}
              </text>
            </box>
          )}
        </For>
        <text fg={props.colors.muted} onMouseDown={() => props.onOpen?.()}>
          Enter 打开 TODO 列表
        </text>
      </SidebarCollapsibleSection>
    </Show>
  );
}

function SidebarFilesSlot(props: {
  files: SidebarModifiedFile[];
  colors: ThemeColors;
  diffColors?: ExtendedThemeColors["diff"];
}) {
  const list = createMemo(() => props.files);
  const addedColor = () => props.diffColors?.added ?? props.colors.success;
  const removedColor = () => props.diffColors?.removed ?? props.colors.error;

  return (
    <Show when={list().length > 0}>
      <SidebarCollapsibleSection
        title="已修改文件"
        summary={`(${list().length})`}
        count={list().length}
        colors={props.colors}
      >
        <For each={list()}>
          {(file) => (
            <box flexDirection="row" justifyContent="space-between" gap={1}>
              <text fg={props.colors.muted} wrapMode="none">
                {file.file}
              </text>
              <box flexDirection="row" gap={1} flexShrink={0}>
                <Show when={file.additions > 0}>
                  <text fg={addedColor()}>+{file.additions}</text>
                </Show>
                <Show when={file.deletions > 0}>
                  <text fg={removedColor()}>-{file.deletions}</text>
                </Show>
              </box>
            </box>
          )}
        </For>
      </SidebarCollapsibleSection>
    </Show>
  );
}

function SidebarTasksSlot(props: { tasks: TaskItem[]; colors: ThemeColors }) {
  return (
    <Show when={props.tasks.length > 0}>
      <SidebarSection title="任务" colors={props.colors}>
        <For each={props.tasks.slice(0, 6)}>
          {(task) => (
            <box flexDirection="row">
              <text fg={taskStatusColor(task.status, props.colors)}>
                {taskIcon(task.status)} {task.id}. {task.label}
              </text>
            </box>
          )}
        </For>
      </SidebarSection>
    </Show>
  );
}

function SidebarFooter(props: { colors: ThemeColors; config?: AppConfigSchema; panelColor: string }) {
  const eventBus = useEventBus();
  const route = useOptionalRoute();
  const [dismissed, setDismissed] = createSignal(false);
  const [workspaceListVisible, setWorkspaceListVisible] = createSignal(false);
  const branch = createMemo(() => gitBranch());
  const path = createMemo(() => {
    const cwd = shortCwd();
    return branch() ? `${cwd}:${branch()}` : cwd;
  });
  const showGettingStarted = createMemo(() => !dismissed() && shouldShowGettingStartedCard(props.config));

  // Workspace 信息
  const currentWorkspace = createMemo(() => {
    if (!props.config) {
      return null;
    }
    return getCurrentWorkspace(props.config);
  });

  const availableWorkspaces = createMemo<WorkspaceConfig[]>(() => {
    if (!props.config) {
      return [];
    }
    return listWorkspaces(props.config);
  });

  const workspaceDisplay = createMemo(() => {
    const ws = currentWorkspace();
    return ws ? getWorkspaceDisplay(ws) : "";
  });

  const handleSwitchWorkspace = (id: string) => {
    if (!props.config) {
      return;
    }
    const result = switchWorkspace(props.config, id);
    if (result) {
      eventBus.publish(AppEvent.Toast, {
        message: `已切换到工作区: ${result.name}`,
        variant: "success",
      });
    } else {
      eventBus.publish(AppEvent.Toast, {
        message: `工作区切换失败`,
        variant: "error",
      });
    }
    setWorkspaceListVisible(false);
  };

  const openSettings = () => {
    if (route) {
      route.navigate({ type: "settings" });
      return;
    }
    eventBus.publish(AppEvent.Toast, {
      message: "未找到路由上下文，请从命令面板打开设置",
      variant: "info",
    });
  };

  return (
    <box flexDirection="column" gap={1} paddingX={1} paddingBottom={1}>
      <Show when={showGettingStarted()}>
        <box
          backgroundColor={props.panelColor}
          border={["left", "right", "top", "bottom"]}
          borderColor={props.colors.border}
          paddingX={2}
          paddingY={1}
          flexDirection="column"
          gap={1}
        >
          <box flexDirection="row" gap={1} justifyContent="space-between">
            <text fg={props.colors.text}>
              <b>开始使用</b>
            </text>
            <text fg={props.colors.muted} onMouseDown={() => setDismissed(true)}>
              {actionClose}
            </text>
          </box>
          <text fg={props.colors.muted}>
            未检测到可用 provider。请先在 ~/.crab/config.json 中配置 `providerConfig` 和 `defaultProvider`。
          </text>
          <box flexDirection="row" justifyContent="space-between" gap={1}>
            <text fg={props.colors.text} onMouseDown={openSettings}>
              配置 Provider
            </text>
            <text fg={props.colors.muted}>/settings</text>
          </box>
        </box>
      </Show>
      {/* Workspace 显示与切换 */}
      <Show when={currentWorkspace()}>
        <box flexDirection="column" gap={0}>
          <box flexDirection="row" gap={1}>
            <text fg={props.colors.muted}>WS:</text>
            <text fg={props.colors.text} onMouseDown={() => setWorkspaceListVisible(!workspaceListVisible())}>
              {workspaceDisplay()} {availableWorkspaces().length > 1 ? "▾" : ""}
            </text>
          </box>
          <Show when={workspaceListVisible() && availableWorkspaces().length > 1}>
            <For each={availableWorkspaces()}>
              {(ws) => (
                <text
                  fg={ws.id === currentWorkspace()?.id ? props.colors.success : props.colors.muted}
                  onMouseDown={() => handleSwitchWorkspace(ws.id)}
                >
                  {"  "}
                  {ws.id === currentWorkspace()?.id ? "●" : "○"} {ws.name} ({ws.directory})
                </text>
              )}
            </For>
          </Show>
        </box>
      </Show>
      <text fg={props.colors.muted}>{path()}</text>
      <text fg={props.colors.muted}>
        <span style={{ fg: props.colors.success }}>{actionBullet}</span> <b>开源</b>
        <span style={{ fg: props.colors.text }}>
          <b>Code</b>
        </span>{" "}
        <span>{VERSION}</span>
      </text>
    </box>
  );
}

export function SidebarPanel(props: {
  colors: ThemeColors;
  extended?: ExtendedThemeColors;
  sessionID?: string;
  tasks: TaskItem[];
  messages: ChatMessage[];
  agentInfo?: AgentInfo;
  agentStatus?: string;
  onAgentClick?: () => void;
  mode?: string;
  yoloOverlay?: boolean;
  contextStats?: ContextStats;
  lspDiagnostics?: LspDiagnosticItem[];
  todos?: SessionTodoItem[];
  config?: AppConfigSchema;
  onTodoOpen?: () => void;
  onCollapse?: () => void;
  width?: number;
}) {
  const sidebarWidth = createMemo(() => props.width ?? SIDEBAR_WIDTH);
  const sidebarColors = createMemo(() => readableSidebarColors(props.colors));
  const modifiedFiles = createMemo(() => buildModifiedFilesFromMessages(props.messages));
  const sessionTitle = createMemo(() => {
    const firstUserMsg = props.messages.find((message) => message.role === "user");
    if (!firstUserMsg) {
      return "新对话";
    }
    const label = firstUserMsg.content.slice(0, 30);
    return label.length < firstUserMsg.content.length ? `${label}...` : label;
  });

  onMount(() => {
    const c = sidebarColors();
    registerSidebarSection(
      "context",
      (p) => (
        <SidebarSlot name="sidebar_context">
          <SidebarContextSection
            colors={c}
            agentInfo={props.agentInfo}
            agentStatus={props.agentStatus}
            mode={props.mode}
            yoloOverlay={props.yoloOverlay}
            contextStats={props.contextStats}
          />
        </SidebarSlot>
      ),
      10,
    );
    registerSidebarSection(
      "mcp",
      (p) => (
        <SidebarSlot name="sidebar_mcp">
          <SidebarMcpSlot colors={c} />
        </SidebarSlot>
      ),
      20,
    );
    registerSidebarSection(
      "lsp",
      (p) => (
        <SidebarSlot name="sidebar_lsp">
          <SidebarLspSlot colors={c} lspDiagnostics={props.lspDiagnostics} />
        </SidebarSlot>
      ),
      30,
    );
    registerSidebarSection(
      "todo",
      (p) => (
        <SidebarSlot name="sidebar_todo">
          <SidebarTodoSlot todos={props.todos ?? []} colors={c} onOpen={props.onTodoOpen} />
        </SidebarSlot>
      ),
      40,
    );
    registerSidebarSection(
      "files",
      (p) => (
        <SidebarSlot name="sidebar_files">
          <SidebarFilesSlot files={modifiedFiles()} colors={c} diffColors={props.extended?.diff} />
        </SidebarSlot>
      ),
      50,
    );
    registerSidebarSection(
      "tasks",
      (p) => (
        <SidebarSlot name="sidebar_tasks">
          <SidebarTasksSlot tasks={props.tasks} colors={c} />
        </SidebarSlot>
      ),
      60,
    );

    onCleanup(() => {
      clearSidebarSections();
    });
  });

  return (
    <box
      flexDirection="column"
      width={sidebarWidth()}
      border={["left"]}
      borderColor={sidebarColors().border}
      flexGrow={0}
      paddingLeft={1}
      backgroundColor={sidebarPanelColor(props.extended)}
    >
      <SidebarSlot name="sidebar_title">
        <box paddingX={1} paddingTop={1} gap={1} flexDirection="column">
          <text>
            <span style={{ bold: true, fg: sidebarColors().text }}>{sessionTitle()}</span>
          </text>
          <Show when={props.sessionID}>
            <text fg={sidebarColors().muted}>#{props.sessionID!.slice(0, 12)}</text>
          </Show>
          <text fg={sidebarColors().muted}>{shortCwd()}</text>
        </box>
      </SidebarSlot>

      <scrollbox flexGrow={1} backgroundColor={sidebarPanelColor(props.extended)}>
        <SidebarSlot name="sidebar_content">
          <box
            flexDirection="column"
            paddingX={1}
            paddingTop={2}
            gap={1}
            backgroundColor={sidebarPanelColor(props.extended)}
          >
            <For each={getSidebarSections()}>
              {(section) => (
                <section.render
                  colors={sidebarColors()}
                  agentInfo={props.agentInfo}
                  agentStatus={props.agentStatus}
                  mode={props.mode}
                  yoloOverlay={props.yoloOverlay}
                  contextStats={props.contextStats}
                  lspDiagnostics={props.lspDiagnostics}
                  todos={props.todos ?? []}
                  tasks={props.tasks}
                  files={modifiedFiles()}
                  diffColors={props.extended?.diff}
                  messages={props.messages}
                  onOpen={props.onTodoOpen}
                />
              )}
            </For>
          </box>
        </SidebarSlot>
      </scrollbox>

      <SidebarSlot name="sidebar_footer">
        <SidebarFooter colors={sidebarColors()} config={props.config} panelColor={sidebarPanelColor(props.extended)} />
      </SidebarSlot>
    </box>
  );
}
