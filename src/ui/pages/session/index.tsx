/**
 * Session 页面
 *
 * 职责:
 *   - 提供对话页入口和 SessionContext
 *   - 管理消息列表、输入框、侧边栏等布局
 *   - 处理各类弹窗和事件监听
 *
 * 模块功能:
 *   - SessionContext: 提供 conceal、timestamps、thinking 等配置
 *   - 消息列表渲染(MessageItem、StreamingOutput)
 *   - 命令面板、Agent 选择器、Skill 选择器等弹窗管理
 *   - 斜杠命令处理(/agents、/export、/undo、/redo 等)
 *   - 消息级 Undo/Redo 快捷键支持
 *
 * 使用场景:
 *   - 主对话界面
 *   - 与 AI 进行交互式对话
 *
 * 边界:
 *   1. 通过 ChatProvider 管理消息状态
 *   2. 通过事件总线接收外部事件
 *   3. 不直接处理消息发送逻辑，委托给 chat context
 *
 * 流程:
 *   1. 初始化 SessionContext 和各类状态
 *   2. 订阅全局事件(命令面板、Agent 选择等)
 *   3. 渲染消息列表和输入区域
 *   4. 处理用户输入和斜杠命令
 */
import {
  Show,
  createContext,
  createEffect,
  createMemo,
  createSignal,
  getOwner,
  onCleanup,
  runWithOwner,
  useContext,
} from "solid-js";
import type { ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard, usePaste, useTerminalDimensions } from "@opentui/solid";
import { KeyboardPriority, useKeyboardPriority } from "@/ui/keyboardPriority";
import {
  buildPermissionBlockedFeedback,
  currentPermissionRequest,
  permissionActive,
} from "@/permission/ui/permissionState";
import { useTheme } from "@/ui/contexts/theme";
import { useRoute } from "@/ui/contexts/route";
import { ChatProvider, useChat } from "@/ui/contexts/chat";
import type { AppConfigSchema } from "@/schema/config";
import type { TodoItem as TodoListPanelItem } from "@/ui/components/todoListPanel";
import { createLogger } from "@/core/logging/logger";
import { createSessionError } from "@/core/errors/appError";
import { getCommandRegistry } from "@/commandPalette/registry";
import { useEventBus } from "@/ui/contexts/eventBus";
import { AppEvent } from "@bus";
import { FeedbackLine } from "@/ui/components/statusFeedback";
import { SessionFooter } from "@/ui/pages/session/footer";
import type { KeyboardEventLike } from "@/ui/types";
import { QuestionPromptEventBridge } from "@/ui/pages/session/question";
import { sessionMessageNodeId } from "@/ui/pages/session/components/sessionTimelineDialog";
import { SubagentFooter } from "@/ui/pages/session/subagentFooter";
import {
  type PromptTrigger,
  buildPromptMeta,
  detectPromptTrigger,
  extractPromptReferences,
} from "@/ui/pages/session/components/promptParts";
import { useLspDiagnostics } from "@/ui/hooks/useLspDiagnostics";
import { MessageListView } from "@/ui/pages/session/panels/MessageListView";
import { SessionOverlays } from "@/ui/pages/session/panels/SessionOverlays";
import { SessionPromptArea } from "@/ui/pages/session/panels/SessionPromptArea";
import { SessionSidebarView } from "@/ui/pages/session/panels/SessionSidebarView";
import { usePromptHistory } from "@/ui/components/prompt/history";
import { usePromptStash } from "@/ui/components/prompt/stash";
import { usePromptFrecency } from "@/ui/components/prompt/frecency";
import { resolveSessionEscapeBehavior } from "@/ui/escBehavior";
import { getAgentStatus as getAgentStatusFromManager, listPrimaryAgents } from "@agent";
import { CompanionSprite, createBuddyProgressBridge, useBuddyNotification } from "@/buddy";
import { showPlatformNotification, isNotificationEnabled } from "@/core/utilities/platformNotification";
import { type SessionTodoItem, extractTodosFromMessages } from "@/ui/pages/session/components/sidebarTodos";
import { skillManager } from "@/extension/skill";
import {
  type PromptAutocompleteOption,
  type PromptAutocompleteSources,
  applyPromptAutocompleteSelection,
  buildPromptAutocompleteOptions,
} from "@/ui/pages/session/components/promptAutocomplete";
import {
  type Extmark,
  createExtmarkFromPaste,
  insertExtmark,
  removeExtmark,
  shouldFoldPastedText,
} from "@/ui/pages/session/components/promptExtmarks";
import { type Breakpoint, SURFACE_PANEL, SURFACE_ROOT, classifyBreakpoint } from "@/ui/themes/sessionTokens";
import { registerSessionEventHandlers } from "@/ui/pages/session/sessionEventHandlers";
import { handleSessionSlashCommand } from "@/ui/pages/session/sessionSlashCommands";
import { buildSessionContextStats } from "@/ui/pages/session/sessionContextStats";
import { buildSessionTaskItems } from "@/ui/pages/session/sessionTaskItems";
import {
  buildSessionPromptAutocompleteSources,
  nextAutocompleteIndex,
} from "@/ui/pages/session/sessionPromptAutocomplete";
import { resolveSessionPromptKeyAction } from "@/ui/pages/session/sessionPromptKeyActions";

const log = createLogger("ui:session");
// TUI parity source contract moved to helpers:
// BuildSessionDiffRoute, slashCmd === "diff", slashArgs.trim() === "session",
// 当前 Session 没有可展示的工具 diff, SessionUndoRequested, SessionRedoRequested, SessionToggleConceal.

// ─── Session Context ─────────────────────────────────────────

interface SessionContextValue {
  sessionID: string | undefined;
  conceal: () => boolean;
  setConceal: (v: boolean) => void;
  showTimestamps: () => boolean;
  setShowTimestamps: (v: boolean) => void;
  showThinking: () => boolean;
  setShowThinking: (v: boolean) => void;
  thinkingMode: () => "show" | "hide" | "auto";
  setThinkingMode: (v: "show" | "hide" | "auto") => void;
  showDetails: () => boolean;
  setShowDetails: (v: boolean) => void;
  sidebarVisible: () => boolean;
  setSidebarVisible: (v: boolean) => void;
}

const sessionContext = createContext<SessionContextValue>();

export function useSessionContext() {
  const ctx = useContext(sessionContext);
  if (!ctx) {
    throw createSessionError("SESSION_INIT_ERROR", "useSessionContext must be used within Session");
  }
  return ctx;
}

function useOptionalRoute() {
  try {
    return useRoute();
  } catch {
    return undefined;
  }
}

// ─── Session 入口 ───────────────────────────────────────────

export function Session(props: { sessionID?: string; config: AppConfigSchema }) {
  return (
    <ChatProvider config={props.config} sessionId={props.sessionID}>
      <SessionInner sessionID={props.sessionID} config={props.config} />
    </ChatProvider>
  );
}

// ─── Session 主体 ───────────────────────────────────────────

interface PromptInputRef {
  focus?: () => void;
  cursorOffset?: number;
}

interface ScrollableRef {
  scrollChildIntoView?: (id: string) => void;
}

function SessionInner(props: { sessionID?: string; config: AppConfigSchema }) {
  const eventBus = useEventBus();
  const theme = useTheme();
  const dimensions = useTerminalDimensions();
  const route = useOptionalRoute();
  const chat = useChat();
  const lspDiag = useLspDiagnostics();

  // Session Context state
  const [conceal, setConceal] = createSignal(true);
  const [showTimestamps, setShowTimestamps] = createSignal(false);
  const [showThinking, setShowThinking] = createSignal(false);
  const [thinkingMode, setThinkingMode] = createSignal<"show" | "hide" | "auto">(props.config.thinking?.mode ?? "auto");
  const [revertedCount, setRevertedCount] = createSignal(0);
  const [showDetails, setShowDetails] = createSignal(true);
  const [sidebarVisible, setSidebarVisible] = createSignal(true);

  const ctx: SessionContextValue = {
    conceal,
    sessionID: props.sessionID,
    setConceal,
    setShowDetails,
    setShowThinking,
    setThinkingMode,
    setShowTimestamps,
    setSidebarVisible,
    showDetails,
    showThinking,
    thinkingMode,
    showTimestamps,
    sidebarVisible,
  };

  // 宠物伴侣通知
  useBuddyNotification();

  // 宠物对话进度桥接 — 自动在思考/工具调用/回答时触发宠物反应
  const buddyBridge = createBuddyProgressBridge(eventBus, () =>
    chat.messages().map((m) => ({
      content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
      role: m.role,
    })),
  );
  onCleanup(() => buddyBridge.destroy());

  // 对话完成 → 桌面通知
  const unsubNotify = eventBus.subscribe(AppEvent.ConversationCompleted, (evt) => {
    if (!isNotificationEnabled()) return;
    const p = evt.properties;
    const title = p.ok ? "✅ 对话完成" : "❌ 对话异常";
    const body = p.ok
      ? `耗时 ${(p.durationMs / 1000).toFixed(1)}s | ${p.textLength} 字 | ${p.toolRounds} 轮工具调用`
      : (p.error ?? "未知错误");
    showPlatformNotification({ title, body });
  });
  onCleanup(unsubNotify);

  // Diff 审查事件 — 运行 git diff 展示变更概览
  const unsubDiff = eventBus.subscribe(AppEvent.DiffReviewShow, () => {
    try {
      const result = Bun.spawnSync(["git", "diff", "--stat"], { stdout: "pipe", stderr: "pipe" });
      const output = new TextDecoder().decode(result.stdout);
      if (output.trim()) {
        log.info(`[Diff]\n${output.trim()}`);
      } else {
        log.info("没有未提交的变更");
      }
    } catch {
      log.warn("获取 git diff 失败");
    }
  });
  onCleanup(unsubDiff);

  // 提交审查事件 — 展示最近提交列表
  const unsubReview = eventBus.subscribe(AppEvent.ReviewCommitShow, () => {
    try {
      const result = Bun.spawnSync(["git", "log", "--oneline", "-10"], { stdout: "pipe", stderr: "pipe" });
      const output = new TextDecoder().decode(result.stdout);
      log.info(`[Review]\n最近提交:\n${output.trim()}`);
    } catch {
      log.warn("获取 git log 失败");
    }
  });
  onCleanup(unsubReview);

  // 分叉面板事件 — 展示分支列表
  const unsubBranch = eventBus.subscribe(AppEvent.BranchPanelShow, (evt) => {
    try {
      const result = Bun.spawnSync(["git", "branch", "--list"], { stdout: "pipe", stderr: "pipe" });
      const output = new TextDecoder().decode(result.stdout);
      const current = evt.properties.branchName;
      log.info(`[Branch]\n分支列表:\n${output.trim()}${current ? `\n分叉目标: ${current}` : ""}`);
    } catch {
      log.warn("获取分支列表失败");
    }
  });
  onCleanup(unsubBranch);

  // UI state
  const [inputValue, setInputValue] = createSignal("");
  const [showAgentPicker, setShowAgentPicker] = createSignal(false);
  const [showRolePicker, setShowRolePicker] = createSignal(false);
  const [showSkillPicker, setShowSkillPicker] = createSignal(false);
  const [showSkillCreation, setShowSkillCreation] = createSignal(false);
  const [showSkillList, setShowSkillList] = createSignal(false);
  const [showTeamPanel, setShowTeamPanel] = createSignal(false);
  const [showTaskPanel, setShowTaskPanel] = createSignal(false);
  const [showTodoList, setShowTodoList] = createSignal(false);
  const [showTimeline, setShowTimeline] = createSignal(false);
  const [showStashList, setShowStashList] = createSignal(false);
  const [syncedTodos, setSyncedTodos] = createSignal<SessionTodoItem[]>([]);
  const [autocompleteTrigger, setAutocompleteTrigger] = createSignal<PromptTrigger | undefined>();
  const [autocompleteQuery, setAutocompleteQuery] = createSignal("");
  const [autocompleteIndex, setAutocompleteIndex] = createSignal(0);
  const [extmarks, setExtmarks] = createSignal<Extmark[]>([]);
  let messageScrollRef: (ScrollBoxRenderable & ScrollableRef) | null = null;
  const breakpoint = createMemo(() => classifyBreakpoint(dimensions().width));
  const bp = breakpoint;
  createEffect(() => {
    if (bp() === "narrow") {
      setSidebarVisible(false);
    } else if (bp() === "wide" || bp() === "xlarge") {
      setSidebarVisible(true);
    }
  });
  const promptBlocked = createMemo(() => Boolean(permissionActive()));
  const permissionBlockedFeedback = createMemo(() => buildPermissionBlockedFeedback(currentPermissionRequest()));
  const sidebarContextStats = createMemo(() => buildSessionContextStats(props.config));
  const promptHistory = usePromptHistory();
  const promptStash = usePromptStash();
  const promptFrecency = usePromptFrecency();
  const sessionOwner = getOwner();
  const runInSessionOwner = (fn: () => void) => {
    if (sessionOwner) {
      runWithOwner(sessionOwner, fn);
    } else {
      fn();
    }
  };
  const undoLastTurn = () => {
    const ok = !chat.loading() && chat.canUndo() ? chat.undo() : false;
    eventBus.publish(AppEvent.Toast, {
      message: ok ? "已撤销最后一轮对话" : "没有可撤销的内容",
      variant: ok ? "success" : "info",
    });
  };

  const redoLastTurn = () => {
    const ok = !chat.loading() && chat.canRedo() ? chat.redo() : false;
    eventBus.publish(AppEvent.Toast, {
      message: ok ? "已恢复对话" : "没有可恢复的内容",
      variant: ok ? "success" : "info",
    });
  };

  const toggleMessageConceal = () => {
    const next = !conceal();
    setConceal(next);
    eventBus.publish(AppEvent.Toast, {
      message: next ? "已隐藏消息细节" : "已显示消息细节",
      variant: "info",
    });
  };

  // ─── Revert/Unrevert ───
  const revertLastTurn = () => {
    if (!props.sessionID || chat.loading()) return;
    const messages = chat.messages();
    if (messages.length === 0) return;
    // 找到最后一条用户消息的索引，revert 到该位置(删除之后的 AI 回复)
    let lastUserIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]!.role === "user") {
        lastUserIdx = i;
        break;
      }
    }
    if (lastUserIdx < 0) return;
    import("@/session/core/revert").then(({ revertToMessage, getRevertedCount }) => {
      const ok = revertToMessage(props.sessionID!, lastUserIdx);
      const count = getRevertedCount(props.sessionID!);
      eventBus.publish(AppEvent.SessionRevertChanged, { revertedCount: count });
      eventBus.publish(AppEvent.Toast, {
        message: ok ? `已 Revert 到消息 ${lastUserIdx}` : "Revert 失败",
        variant: ok ? "success" : "error",
      });
    });
  };

  const unrevertLastTurn = () => {
    if (!props.sessionID || chat.loading()) return;
    import("@/session/core/revert").then(({ unrevert, getRevertedCount }) => {
      const ok = unrevert(props.sessionID!);
      const count = getRevertedCount(props.sessionID!);
      eventBus.publish(AppEvent.SessionRevertChanged, { revertedCount: count });
      eventBus.publish(AppEvent.Toast, {
        message: ok ? "已恢复 Revert 的消息" : "没有可恢复的 Revert",
        variant: ok ? "success" : "info",
      });
    });
  };

  // ─── 消息级 Undo/Redo 快捷键 ───
  // Ctrl+Z = undo(当输入框未聚焦时)，Ctrl+Shift+Z / Ctrl+Y = redo
  // Esc = 中断流(优先级低于 DialogRoot 的 Esc 关闭弹窗)
  useKeyboardPriority(KeyboardPriority.SESSION_PAGE, "session-page", (event) => {
    const escapeBehavior = resolveSessionEscapeBehavior({ loading: chat.loading() });
    if (event.name === "escape" && escapeBehavior === "abort-stream") {
      const interrupted = chat.interrupt();
      if (interrupted) {
        event.stopPropagation?.();
        eventBus.publish(AppEvent.Toast, {
          message: "已请求中断当前对话",
          variant: "info",
        });
        return;
      }
    }
    if (event.ctrl && event.name === "z" && !event.shift) {
      undoLastTurn();
    }
    if ((event.ctrl && event.name === "z" && event.shift) || (event.ctrl && event.name === "y")) {
      redoLastTurn();
    }
    // Ctrl+Shift+T = 循环切换三态 Thinking 模式 (auto → show → hide → auto)
    if (event.ctrl && event.shift && event.name === "t") {
      const current = thinkingMode();
      const next = current === "auto" ? "show" : current === "show" ? "hide" : "auto";
      setThinkingMode(next);
      const labels: Record<typeof next, string> = { auto: "自动", hide: "隐藏", show: "显示" };
      eventBus.publish(AppEvent.Toast, {
        message: `Thinking 模式: ${labels[next]}`,
        variant: "info",
      });
      event.stopPropagation?.();
    }
    // Ctrl+Shift+R = Revert 到最后一条用户消息
    if (event.ctrl && event.shift && event.name === "r") {
      revertLastTurn();
      event.stopPropagation?.();
    }
    // Ctrl+Shift+U = Unrevert(恢复最近一次 revert)
    if (event.ctrl && event.shift && event.name === "u") {
      unrevertLastTurn();
      event.stopPropagation?.();
    }
  });

  const cleanupSessionEvents = registerSessionEventHandlers({
    loading: chat.loading,
    redoLastTurn,
    runInSessionOwner,
    send: chat.send,
    sessionId: props.sessionID,
    setShowAgentPicker,
    setShowRolePicker,
    setShowSkillCreation,
    setShowSkillList,
    setShowSkillPicker,
    setShowTaskPanel,
    setShowTeamPanel,
    setShowTimeline,
    setSidebarVisible,
    setSyncedTodos,
    toggleMessageConceal,
    undoLastTurn,
  });
  onCleanup(cleanupSessionEvents);

  // 监听 Revert 状态变更
  const unsubRevertChanged = eventBus.subscribe(AppEvent.SessionRevertChanged, (evt) => {
    setRevertedCount(evt.properties.revertedCount as number);
  });
  onCleanup(() => unsubRevertChanged());

  let inputRef: PromptInputRef | null = null;

  const promptAutocompleteSources = createMemo<PromptAutocompleteSources>(() => {
    const registry = getCommandRegistry();
    return buildSessionPromptAutocompleteSources({
      agents: listPrimaryAgents().map((agent) => agent.name),
      commands: registry.sortByFrecency(registry.listAll()),
      recentFiles: promptFrecency.sortByFrecency(Object.keys(promptFrecency.data())),
      skills: skillManager.listVisible().map((skill) => skill.name),
    });
  });

  const promptAutocompleteOptions = createMemo<PromptAutocompleteOption[]>(() => {
    const trigger = autocompleteTrigger();
    if (!trigger) {
      return [];
    }
    return buildPromptAutocompleteOptions(trigger, autocompleteQuery(), promptAutocompleteSources());
  });

  const promptAutocompleteVisible = createMemo(() => Boolean(autocompleteTrigger()));

  const sessionLabel = () => (props.sessionID ? `#${props.sessionID.slice(0, 12)}` : "新对话");

  const agentLabel = () => {
    const info = chat.agentInfo();
    return info ? info.label : "Agent";
  };

  const promptMeta = createMemo(() =>
    buildPromptMeta({
      agent: agentLabel(),
      mode: chat.mode(),
      model: props.config.defaultProvider.model,
      provider: props.config.defaultProvider.provider,
    }),
  );

  const promptRightHint = createMemo(() => {
    if (autocompleteTrigger()) {
      return "tab 补全";
    }
    const refs = extractPromptReferences(inputValue());
    if (refs.length > 0) {
      return `${refs.length} context`;
    }
    if (permissionActive()) {
      return "permission";
    }
    if (chat.loading()) {
      return "esc 中断";
    }
    return "esc 中断";
  });

  function closeAutocomplete() {
    setAutocompleteTrigger(undefined);
    setAutocompleteQuery("");
    setAutocompleteIndex(0);
  }

  function setAutocomplete(trigger: PromptTrigger | undefined, value: string) {
    if (!trigger) {
      closeAutocomplete();
      return;
    }
    const normalized = value.trimStart();
    if (!normalized.startsWith(trigger)) {
      closeAutocomplete();
      return;
    }
    const query = normalized.slice(1);
    if (trigger === "/" && /\s/.test(query)) {
      closeAutocomplete();
      return;
    }
    setAutocompleteTrigger(trigger);
    setAutocompleteQuery(query);
    setAutocompleteIndex(0);
  }

  function selectAutocompleteOption(option?: PromptAutocompleteOption) {
    const trigger = autocompleteTrigger();
    if (!trigger || !option) {
      return;
    }
    if (option.kind === "file") {
      promptFrecency.touch(option.value);
    }
    const result = applyPromptAutocompleteSelection(inputValue(), trigger, option);
    closeAutocomplete();
    setInputValue(result.value);
    // 如果选中了 file/agent/skill，创建 extmark
    if (result.extmark) {
      const insertResult = insertExtmark(result.value, result.extmark, extmarks());
      setInputValue(insertResult.text);
      setExtmarks(insertResult.extmarks);
    }
    queueMicrotask(() => inputRef?.focus?.());
  }

  function handleRemoveExtmark(id: string) {
    setExtmarks((prev) => removeExtmark(prev, id));
  }

  function handlePaste(text: string) {
    if (!shouldFoldPastedText(text)) {
      return false;
    }
    const currentText = inputValue();
    const pasteExtmark = createExtmarkFromPaste(text, currentText.length);
    const insertResult = insertExtmark(currentText, pasteExtmark, extmarks());
    setInputValue(insertResult.text);
    setExtmarks(insertResult.extmarks);
    queueMicrotask(() => inputRef?.focus?.());
    return true;
  }

  // 粘贴事件监听:多行/长文本/URL/文件路径自动折叠为 extmark
  usePaste((event) => {
    const text = new TextDecoder().decode(event.bytes);
    if (handlePaste(text)) {
      event.preventDefault();
    }
  });

  function moveAutocomplete(direction: -1 | 1) {
    const items = promptAutocompleteOptions();
    if (items.length === 0) {
      return;
    }
    setAutocompleteIndex((current) => nextAutocompleteIndex(current, items.length, direction));
  }

  function stashCurrentPrompt() {
    const value = inputValue().trim();
    if (!value) {
      return false;
    }
    promptStash.push(value);
    setInputValue("");
    closeAutocomplete();
    queueMicrotask(() => inputRef?.focus?.());
    eventBus.publish(AppEvent.Toast, { message: "已暂存当前输入", variant: "success" });
    return true;
  }

  function restorePromptFromStash(entryInput: string) {
    setInputValue(entryInput);
    closeAutocomplete();
    queueMicrotask(() => inputRef?.focus?.());
  }

  const tasks = createMemo(() => buildSessionTaskItems(chat.messages()));

  const sessionTodos = createMemo(() => {
    const fromSync = syncedTodos();
    if (fromSync.length > 0) {
      return fromSync;
    }
    return extractTodosFromMessages(chat.messages(), props.sessionID);
  });

  const todoPanelItems = createMemo<TodoListPanelItem[]>(() =>
    sessionTodos().map((todo) => ({
      content: todo.content,
      id: todo.id,
      parentId: todo.parentId,
      phaseId: todo.phaseId,
      status: todo.status === "in_progress" ? "inProgress" : todo.status,
    })),
  );

  const isSubagentMode = createMemo(() => chat.agentInfo()?.mode === "subagent");
  const effectiveSidebarVisible = createMemo(() => sidebarVisible() && !isSubagentMode());

  /** Shell 模式: 直接执行 shell 命令，将结果作为系统消息显示 */
  const handleShellCommand = async (command: string) => {
    const { executeLocal } = await import("@/tool/bash/bashLocalExecution");
    const cwd = process.cwd();
    log.info(`Shell 模式执行: $ ${command}`);

    try {
      const result = await executeLocal(command, cwd, 30_000);
      const exitCode = result.exitCode as number;
      const output = (result.output as string) ?? "";
      const truncated = output.length > 10_000;
      const displayOutput = truncated
        ? `${output.slice(0, 10_000)}\n... (输出已截断，共 ${output.length} 字符)`
        : output;
      const shellResult =
        exitCode === 0 ? `$ ${command}\n${displayOutput}` : `$ ${command}\n[退出码: ${exitCode}]\n${displayOutput}`;

      chat.addSystemMessage(`\`\`\`shell\n${shellResult}\n\`\`\``);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      log.error(`Shell 模式执行失败: ${errMsg}`);
      eventBus.publish(AppEvent.Toast, { message: `Shell 执行失败: ${errMsg}`, variant: "error" });
    }
  };

  const handleSubmit = (val: string) => {
    const trimmed = val.trim();
    log.debug(`Session 输入: ${trimmed.slice(0, 80)}`);
    closeAutocomplete();
    if (!trimmed) {
      return;
    }
    promptHistory.push(trimmed);

    // Shell 模式: 以 ! 开头，直接执行 shell 命令
    if (trimmed.startsWith("!")) {
      const shellCommand = trimmed.slice(1).trim();
      if (!shellCommand) {
        return;
      }
      setInputValue("");
      setExtmarks([]);
      handleShellCommand(shellCommand);
      return;
    }

    if (trimmed.startsWith("/")) {
      setInputValue("");
      setExtmarks([]);
      handleSessionSlashCommand(
        trimmed,
        {
          messages: chat.messages,
          redoLastTurn,
          route,
          sessionId: props.sessionID,
          setShowAgentPicker,
          setShowTimeline,
          undoLastTurn,
        },
        eventBus,
      );
      return;
    }

    if (trimmed && !chat.loading()) {
      chat.send(trimmed);
      log.debug(`发送消息: ${trimmed.length} 字符`);
      setInputValue("");
      setExtmarks([]);
      queueMicrotask(() => inputRef?.focus?.());
    }
  };

  const handlePromptInput = (val: string) => {
    setInputValue(val);
    setAutocomplete(detectPromptTrigger(val), val);
  };

  const handlePromptTrigger = (trigger: PromptTrigger, value: string) => {
    setAutocomplete(trigger, value);
  };

  const handlePromptKeyDown = (event: KeyboardEventLike) => {
    const items = promptAutocompleteOptions();
    const action = resolveSessionPromptKeyAction({
      autocompleteOpen: Boolean(autocompleteTrigger()),
      cursorOffset: inputRef?.cursorOffset ?? 0,
      event,
      inputLength: inputValue().length,
    });

    switch (action) {
      case "autocompleteClose": {
        const escapeBehavior = resolveSessionEscapeBehavior({ autocompleteOpen: true });
        if (escapeBehavior !== "close-overlay") {
          return false;
        }
        event.stopPropagation?.();
        closeAutocomplete();
        return true;
      }
      case "autocompletePrevious": {
        event.stopPropagation?.();
        moveAutocomplete(-1);
        return true;
      }
      case "autocompleteNext": {
        event.stopPropagation?.();
        moveAutocomplete(1);
        return true;
      }
      case "autocompleteSelect": {
        event.stopPropagation?.();
        selectAutocompleteOption(items[autocompleteIndex()] ?? items[0]);
        return true;
      }
      case "historyPrevious": {
        const next = promptHistory.move(-1, inputValue());
        if (!next) {
          return false;
        }
        event.stopPropagation?.();
        setInputValue(next);
        closeAutocomplete();
        queueMicrotask(() => inputRef?.focus?.());
        return true;
      }
      case "historyNext": {
        const next = promptHistory.move(1, inputValue());
        if (next === undefined) {
          return false;
        }
        event.stopPropagation?.();
        setInputValue(next);
        closeAutocomplete();
        queueMicrotask(() => inputRef?.focus?.());
        return true;
      }
      case "stashCurrent": {
        event.stopPropagation?.();
        return stashCurrentPrompt();
      }
      case "restoreLastStash": {
        const entry = promptStash.pop();
        if (!entry) {
          return false;
        }
        event.stopPropagation?.();
        restorePromptFromStash(entry.input);
        eventBus.publish(AppEvent.Toast, { message: "已恢复最后一条暂存输入", variant: "success" });
        return true;
      }
      case "openStashList": {
        event.stopPropagation?.();
        closeAutocomplete();
        setShowStashList(true);
        return true;
      }
      case "none": {
        break;
      }
    }

    const escapeBehavior = resolveSessionEscapeBehavior({ autocompleteOpen: Boolean(autocompleteTrigger()) });
    if (event.name === "escape" && escapeBehavior === "close-overlay") {
      event.stopPropagation?.();
      closeAutocomplete();
      return true;
    }

    return false;
  };

  // Sidebar toggle
  const toggleSidebar = () => setSidebarVisible(!sidebarVisible());
  const moveToTimelineMessage = (messageID: string) => {
    messageScrollRef?.scrollChildIntoView?.(sessionMessageNodeId(messageID));
  };
  const reuseMessageText = (text: string) => {
    const next = text.trim();
    if (!next) {
      return;
    }
    setInputValue(next);
    closeAutocomplete();
    queueMicrotask(() => inputRef?.focus?.());
  };

  return (
    <sessionContext.Provider value={ctx}>
      <box flexDirection="row" flexGrow={1} minHeight={0} backgroundColor={SURFACE_ROOT}>
        {/* ═══ 主区域 ═══ */}
        <box
          flexDirection="column"
          flexGrow={1}
          minHeight={0}
          paddingBottom={1}
          paddingLeft={2}
          paddingRight={2}
          gap={1}
          backgroundColor={SURFACE_ROOT}
        >
          {/* ── 消息区域 ── */}
          <MessageListView
            scrollRef={(ref) => {
              messageScrollRef = ref;
            }}
            colors={theme.colors}
            extended={theme.extended}
            messages={chat.messages()}
            loading={chat.loading()}
            streamingText={chat.streamingText()}
            streamingReasoning={chat.streamingReasoning()}
            msgCount={() => chat.messages().length}
            sessionLabel={sessionLabel}
            agentLabel={agentLabel}
            chatMode={() => chat.mode()}
            yoloOverlay={() => chat.yoloOverlay()}
            conceal={() => conceal()}
            showThinking={() => showThinking()}
            thinkingMode={() => thinkingMode()}
            revertedCount={revertedCount}
            onReuseText={reuseMessageText}
            compact={breakpoint() === "narrow"}
          />

          {/* ── 底部状态、阻塞交互与 Prompt Stack ── */}
          <box flexShrink={0} position="relative" flexDirection="column" gap={1}>
            <CompanionSprite terminalColumns={dimensions().width} />
            <SessionFooter config={props.config} toggleSidebar={toggleSidebar} />

            <Show when={permissionActive()}>
              <box
                backgroundColor={SURFACE_PANEL}
                border={["left"]}
                borderColor={theme.colors.warning}
                paddingLeft={2}
                paddingTop={1}
                paddingBottom={1}
              >
                {(() => {
                  const feedback = permissionBlockedFeedback();
                  return (
                    <box flexDirection="column" gap={1}>
                      <FeedbackLine tone="busy" message={feedback.message} />
                      <Show when={feedback.toolLine}>
                        <text fg={theme.colors.text}>{feedback.toolLine}</text>
                      </Show>
                      <Show when={feedback.riskLine}>
                        <text fg={theme.colors.warning}>{feedback.riskLine}</text>
                      </Show>
                      <Show when={feedback.commandLine}>
                        <text fg={theme.colors.muted} wrapMode="word">
                          {feedback.commandLine}
                        </text>
                      </Show>
                      <Show when={feedback.descriptionLine}>
                        <text fg={theme.colors.muted} wrapMode="word">
                          {feedback.descriptionLine}
                        </text>
                      </Show>
                      <text fg={theme.colors.muted}>{feedback.shortcutHint}</text>
                    </box>
                  );
                })()}
              </box>
            </Show>

            <QuestionPromptEventBridge />

            <Show when={isSubagentMode()}>
              <SubagentFooter label={agentLabel()} />
            </Show>

            {/* 浮层面板组 */}
            <SessionOverlays
              config={props.config}
              colors={theme.colors}
              showAgentPicker={showAgentPicker}
              setShowAgentPicker={setShowAgentPicker}
              showRolePicker={showRolePicker}
              setShowRolePicker={setShowRolePicker}
              showSkillPicker={showSkillPicker}
              setShowSkillPicker={setShowSkillPicker}
              showSkillCreation={showSkillCreation}
              setShowSkillCreation={setShowSkillCreation}
              showSkillList={showSkillList}
              setShowSkillList={setShowSkillList}
              showTeamPanel={showTeamPanel}
              setShowTeamPanel={setShowTeamPanel}
              showTaskPanel={showTaskPanel}
              setShowTaskPanel={setShowTaskPanel}
              showTodoList={showTodoList}
              setShowTodoList={setShowTodoList}
              showTimeline={showTimeline}
              setShowTimeline={setShowTimeline}
              showStashList={showStashList}
              setShowStashList={setShowStashList}
              messages={chat.messages()}
              onSelectAgent={(name) => chat.switchAgent(name)}
              onMoveTimeline={moveToTimelineMessage}
              onReuseFromTimeline={(text) => {
                setInputValue(text);
                queueMicrotask(() => inputRef?.focus?.());
              }}
              todoPanelItems={todoPanelItems}
              promptStash={promptStash}
              restorePromptFromStash={restorePromptFromStash}
              promptAutocompleteVisible={promptAutocompleteVisible}
              promptAutocompleteOptions={promptAutocompleteOptions}
              autocompleteIndex={autocompleteIndex}
              setAutocompleteIndex={setAutocompleteIndex}
              selectAutocompleteOption={selectAutocompleteOption}
            />

            {/* Prompt 输入区 */}
            <SessionPromptArea
              visible={() => !promptBlocked()}
              inputRef={(ref) => {
                inputRef = ref;
              }}
              value={inputValue}
              onInput={handlePromptInput}
              onTrigger={handlePromptTrigger}
              onKeyDown={handlePromptKeyDown}
              onSubmit={handleSubmit}
              onFocus={() => setShowStashList(false)}
              onBlur={() => {}}
              loading={chat.loading()}
              placeholder="输入消息，Enter 发送，@ 添加上下文"
              colors={theme.colors}
              disabled={promptBlocked}
              meta={promptMeta()}
              rightHint={promptRightHint()}
              promptBlocked={promptBlocked}
              extmarks={extmarks()}
              onRemoveExtmark={handleRemoveExtmark}
            />
          </box>
        </box>

        {/* ═══ 侧边栏 ═══ */}
        <SessionSidebarView
          visible={effectiveSidebarVisible}
          breakpoint={breakpoint}
          colors={theme.colors}
          extended={theme.extended}
          sessionID={props.sessionID}
          tasks={tasks()}
          messages={chat.messages()}
          config={props.config}
          agentInfo={chat.agentInfo()}
          agentStatus={getAgentStatusFromManager(chat.agentName())}
          onAgentClick={() => setShowAgentPicker(true)}
          mode={chat.mode()}
          yoloOverlay={chat.yoloOverlay()}
          lspDiagnostics={lspDiag.diagnostics()}
          todos={sessionTodos()}
          onTodoOpen={() => setShowTodoList(true)}
          contextStats={sidebarContextStats()}
          onCollapse={() => setSidebarVisible(false)}
          onExpand={() => setSidebarVisible(true)}
        />
      </box>
    </sessionContext.Provider>
  );
}
