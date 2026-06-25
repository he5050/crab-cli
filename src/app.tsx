/**
 * [Crab CLI 根组件]
 *
 * 职责:
 *   - 初始化并组装所有 Context Provider
 *   - 管理应用路由切换(home / session / settings / help / mcp / pixel-editor)
 *   - 注册全局键盘导航和命令系统
 *   - 处理全局事件订阅(会话列表、主题选择、Profile 面板)
 *   - 提供错误边界，防止渲染错误导致应用崩溃
 *
 * 模块功能:
 *   - TUI 应用创建(createTuiApp)
 *   - Context Provider 嵌套(Keymap、Exit、Config、KV、Toast、Route、Theme、Dialog、CommandPalette、PromptRef、EditorContext)
 *   - 路由渲染(Switch/Match 匹配不同页面)
 *   - 命令系统初始化(createAppCommands)
 *   - 按键绑定注册(registerAppKeybinds)
 *   - 全局事件监听(SessionListShow、ThemePickerShow、ProfilePanelShow)
 *   - 文本选择自动复制到剪贴板
 *
 * 使用场景:
 *   - CLI 入口调用 createTuiApp 启动 TUI 应用
 *   - 用户通过键盘快捷键导航不同页面
 *   - 用户打开命令面板执行命令
 *   - 用户切换会话、切换主题、查看帮助
 *   - 用户选中文本时自动复制
 *
 * 边界:
 *   1. 所有 JSX 渲染的入口，不含具体业务逻辑
 *   2. Ctrl+C 退出由 renderer 的 exitOnCtrlC 统一管理，此处不重复处理
 *   3. 路由数据通过 useRouteData 类型安全访问
 *   4. 命令依赖通过 CommandDeps 接口注入
 *   5. 剪贴板复制优先使用 OSC52，失败回退到 crab clipboard
 *
 * 流程:
 *   1. 创建 keymap 实例并注册 crab-cli 绑定
 *   2. 嵌套所有 Context Provider 构建组件树
 *   3. 初始化命令系统(createAppCommands + registerAll)
 *   4. 注册应用按键绑定(createDefaultHandlers + registerAppKeybinds)
 *   5. 订阅全局事件(会话列表、主题选择、Profile 面板显示)
 *   6. 监听文本选择事件，自动复制到剪贴板
 *   7. 根据路由数据渲染对应页面组件
 *   8. 渲染底部状态栏(首页显示资源使用，其他页显示标准状态栏)
 *
 */
import { render, useKeyboard, useRenderer } from "@opentui/solid";
import type { CliRenderer } from "@opentui/core";
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui";

/** 扩展渲染器类型 — 桥接 opentui 类型与运行时实际能力 */
type ExtendedRenderer = CliRenderer & {
  /** 事件监听(selection 等平台事件) */
  on?: (event: string, handler: (...args: any[]) => void) => void;
  off?: (event: string, handler: (...args: any[]) => void) => void;
};

/** 将 CliRenderer 安全转换为 ExtendedRenderer */
function asExtendedRenderer(r: CliRenderer): ExtendedRenderer {
  return r as unknown as ExtendedRenderer;
}
import { Switch, Match, ErrorBoundary, createEffect, createSignal, onCleanup, type JSX } from "solid-js";
import { globalBus, type EventBus } from "@bus";
import { AppEvent } from "@bus";
import { EventBusProvider, useEventBus } from "@/ui/contexts/eventBus";
import { createId } from "@/core/identity";
import { ExitProvider, useExit } from "@/ui/contexts/exit";
import { RouteProvider, useRoute, useRouteData, consumeInvalidResumeSession, type Route } from "@/ui/contexts/route";
import { useTheme, type ThemeMode } from "@/ui/contexts/theme";
import { useKV } from "@/ui/contexts/kv";
import { CrabKeymapProvider, registerCrabKeymap } from "@/ui/keymap";
import { DataProviders, UIProviders } from "@/ui/contexts/providers";
import { Home } from "@/ui/pages/home";
import { Session } from "@/ui/pages/session/index";
import { useConfig } from "@/ui/contexts/config";
import { Settings } from "@/ui/pages/settings";
import { Help } from "@/ui/pages/help";
import { ResourceUsageStatus, StatusBar } from "@/ui/components/statusBar";
import { ToastContainer } from "@/ui/components/toastContainer";
import { DialogRoot } from "@/ui/components/dialogRoot";
import { LEADER_KEY_BINDINGS, WhichKeyPanel } from "@/ui/components/whichKey";
import { McpPage } from "@/ui/pages/mcp";
import { PixelEditor } from "@/ui/pages/pixelEditor";
import { PluginRoute } from "@/ui/pages/pluginRoute";
import { FirstRunOverlay, shouldShowFirstRun } from "@/ui/components/firstRunOverlay";
import { markDismissed } from "@/ui/utils/firstRunState";
import { Slot, updateSlotContext, usePluginRoutes } from "@/ui/plugins/slots";
import type { AppConfigSchema as AppConfigType } from "@/schema/config";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { exec } from "node:child_process";
import { getLogDir } from "@/core/logging/logStore";
import { createLogger } from "@/core/logging/logger";
import { getCommandRegistry } from "@/commandPalette/registry";
import { createAppCommands, type CommandDeps } from "@/commandPalette/appCommands";
import { registerAppKeybinds, handleKeyEvent, createDefaultHandlers } from "@/ui/utils/keybind";
import { ensureSession, listSessions } from "@session";
import { cleanupExpiredStates, findRecoverableSessions } from "@/agent";
import { getSessionMessages, messagePartsToChatParts, messageRoleToChatRole } from "@session";
import { SESSION_SWITCHER_PINNED_KEY, normalizePinnedSessionIds } from "@/ui/components/sessionSwitcherState";
import type { ModelMessage } from "ai";
import { createModelMessageFromRecord } from "@/conversation/message/messageFactories";
import type { KeyboardEventLike } from "@/ui/types";
import { KeyboardPriorityProvider } from "@/ui/keyboardPriority";
import { createEditorCommand } from "@/command/editor";
import { usePromptRef } from "@/ui/contexts/prompt";

const log = createLogger("app");

/** ErrorBoundary 内的键盘重置组件:按 Enter 触发 reset */
function KeyPressReset(props: { onReset: () => void }) {
  useKeyboard((event: KeyboardEventLike) => {
    if (event.name === "return" || event.name === "enter") {
      props.onReset();
    }
  });
  return null;
}

/** 合并所有 Context Provider，减少嵌套层级(11 层 → 5 层) */
function AppProviders(props: {
  children: JSX.Element;
  appConfig: AppConfigType;
  initialTheme: string;
  initialMode: ThemeMode;
  keymap: any;
  commandRun: (cmd: string) => void;
  commandShow: () => void;
  eventBus?: EventBus;
}) {
  return (
    <CrabKeymapProvider keymap={props.keymap}>
      <ExitProvider>
        <RouteProvider>
          <EventBusProvider eventBus={props.eventBus}>
            <DataProviders config={props.appConfig} initialTheme={props.initialTheme} initialMode={props.initialMode}>
              <UIProviders commandRun={props.commandRun} commandShow={props.commandShow}>
                {props.children}
              </UIProviders>
            </DataProviders>
          </EventBusProvider>
        </RouteProvider>
      </ExitProvider>
    </CrabKeymapProvider>
  );
}

/**
 * 创建 TUI 应用。
 *
 * @param renderer - OpenTUI 渲染器实例
 * @param mode - 主题模式(dark/light)
 * @param appConfig - 应用配置
 */
export async function createTuiApp(
  renderer: CliRenderer,
  mode: ThemeMode,
  appConfig: AppConfigType,
  eventBus?: EventBus,
) {
  log.info("创建 TUI 应用中...");
  const initialTheme = appConfig.theme;

  const keymap = createDefaultOpenTuiKeymap(asExtendedRenderer(renderer));
  const offKeymap = registerCrabKeymap(keymap, asExtendedRenderer(renderer));

  await render(
    () => (
      <AppProviders
        keymap={keymap}
        appConfig={appConfig}
        initialTheme={initialTheme}
        initialMode={mode}
        eventBus={eventBus}
        commandRun={(cmd) => {
          const registry = getCommandRegistry();
          registry.executeSlash(cmd);
        }}
        commandShow={() => (eventBus ?? globalBus).publish(AppEvent.CommandPaletteShow, { query: "" })}
      >
        <CrabApp />
      </AppProviders>
    ),
    renderer as unknown as Parameters<typeof render>[1],
  );
  log.info("TUI 渲染完成，进入主事件循环");
}

/**
 * Session 包装组件 — 注入 config。
 */
function SessionWrapper(props: { sessionID?: string }) {
  const { config } = useConfig();
  return <Session sessionID={props.sessionID} config={config} />;
}

/**
 * CrabApp 根组件。
 * 键盘导航:Enter→对话页，S→设置页，M→MCP页，Esc→返回首页。
 * Ctrl+C 退出由 renderer (exitOnCtrlC: true) 统一处理，此处不重复。
 */
function CrabApp() {
  const eventBus = useEventBus();
  const route = useRoute();
  const renderer = useRenderer();
  const exit = useExit();
  const kv = useKV();

  // 类型安全的路由数据访问
  const sessionRoute = useRouteData("session");
  const pluginRoute = useRouteData("plugin");
  const { config } = useConfig();
  const theme = useTheme();
  const [showLeaderKeys, setShowLeaderKeys] = createSignal(false);
  const invalidResumeSession = consumeInvalidResumeSession();

  // [P1-T7] 终端挂起/恢复状态
  const [suspended, setSuspended] = createSignal(false);

  /** 挂起 TUI，恢复原生终端 */
  const suspendTui = () => {
    if (suspended()) return;
    log.info("挂起 TUI，恢复原生终端");
    try {
      asExtendedRenderer(renderer).suspend?.();
      setSuspended(true);
      // 输出提示信息到原生终端
      process.stdout.write("\x1b[2J\x1b[H");
      process.stdout.write("Crab CLI 已挂起。输入 fg 恢复。\n");
    } catch (error) {
      log.error(`挂起 TUI 失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  /** 恢复 TUI */
  const resumeTui = () => {
    if (!suspended()) return;
    log.info("恢复 TUI");
    try {
      asExtendedRenderer(renderer).resume?.();
      setSuspended(false);
    } catch (error) {
      log.error(`恢复 TUI 失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  // [P1-21] 首次引导:同步读取避免首帧闪烁
  const [firstRun, setFirstRun] = createSignal<boolean>(shouldShowFirstRun());
  const dismissFirstRun = () => {
    void markDismissed();
    setFirstRun(false);
  };

  createEffect(() => {
    updateSlotContext({
      theme: {
        colors: theme.colors,
        mode: theme.mode,
        themeName: theme.themeName,
      },
      config: config as unknown as Record<string, unknown>,
    });

    // Agent 状态持久化:启动时清理过期状态 + SIGTERM 安全网
    const cleaned = cleanupExpiredStates();
    if (cleaned > 0) log.info(`启动清理:${cleaned} 条过期 Agent 状态`);

    // 检测可恢复会话
    const recoverable = findRecoverableSessions();
    if (recoverable.length > 0) {
      log.info(`检测到 ${recoverable.length} 个可恢复会话`);
      eventBus.publish(AppEvent.AgentRecoveryDetected, { sessions: recoverable });
    }

    const sigtermHandler = () => {
      cleanupExpiredStates();
    };
    process.on("SIGTERM", sigtermHandler);
    onCleanup(() => {
      process.off("SIGTERM", sigtermHandler);
    });
  });

  if (invalidResumeSession) {
    queueMicrotask(() => {
      eventBus.publish(AppEvent.Toast, {
        message: `未找到可恢复的会话: ${invalidResumeSession}`,
        variant: "warning",
      });
    });
  }

  // Initialize command system
  const registry = getCommandRegistry();
  const deps: CommandDeps = {
    navigate: (r) => route.navigate(r as Parameters<typeof route.navigate>[0]),
    back: () => route.back(),
    requestExit: () => exit.requestExit(),
    showToast: (msg, variant) => eventBus.publish(AppEvent.Toast, { message: msg, variant: variant ?? "info" }),
    getConfig: () => config,
    getCurrentSessionId: () => (route.data.type === "session" ? route.data.sessionId : undefined),
    getConversationHistory: () => {
      if (route.data.type !== "session") return [];
      return getSessionMessages(route.data.sessionId).map((record) =>
        createModelMessageFromRecord(messageRoleToChatRole(record.role), messagePartsToChatParts(record.parts)),
      );
    },
    createSession: () => {
      const sessionID = createId("ses");
      ensureSession(sessionID, {
        model: config.defaultProvider.model,
        projectDir: process.cwd(),
      });
      eventBus.publish(AppEvent.SessionCreated, { sessionId: sessionID });
      route.navigate({ type: "session", sessionId: sessionID });
    },
  };
  registry.registerAll(createAppCommands(deps));

  // 注册 /editor 命令
  registry.register(createEditorCommand(() => usePromptRef().current));

  // [P1-T7] 注册 /fg 命令 — 恢复挂起的 TUI
  registry.register({
    name: "app.fg",
    title: "恢复 TUI",
    description: "恢复挂起的 Crab CLI TUI 界面",
    category: "框架",
    slashName: "fg",
    hidden: true,
    run: () => {
      resumeTui();
    },
  });

  log.info("Command system initialized");

  const keybindHandlers = createDefaultHandlers({
    getLogDir,
    exec,
    os,
    fs,
    eventBus,
    AppEvent,
    routeBack: () => route.back(),
    createSession: () => {
      const sessionID = createId("ses");
      ensureSession(sessionID, {
        model: config.defaultProvider.model,
        projectDir: process.cwd(),
      });
      eventBus.publish(AppEvent.SessionCreated, { sessionId: sessionID });
      route.navigate({ type: "session", sessionId: sessionID });
    },
    navigateToSettings: () => route.navigate({ type: "settings" }),
    navigateToHelp: () => route.navigate({ type: "help" }),
    navigateToMcp: () => route.navigate({ type: "mcp" }),
    cycleTheme: () => theme.cycleTheme(),
    requestExit: () => exit.requestExit(),
    quickSwitchSession: (slot: number) => {
      const pinned = normalizePinnedSessionIds(
        kv.get(SESSION_SWITCHER_PINNED_KEY),
        listSessions().map((item) => item.id),
      );
      const sessionId = pinned[slot - 1];
      const session = listSessions().find((item) => item.id === sessionId);
      if (!session) {
        eventBus.publish(AppEvent.Toast, { message: `没有可切换的 pinned Session #${slot}`, variant: "info" });
        return;
      }
      eventBus.publish(AppEvent.SessionSwitched, { sessionId: session.id });
      route.navigate({ type: "session", sessionId: session.id });
    },
  });
  registerAppKeybinds(keybindHandlers, eventBus);
  log.info("Keybind system initialized");

  // 监听队友状态变更，通过 toast 通知用户
  const unsubTeamStatus = eventBus.subscribe(AppEvent.TeamMateStatusChanged, (ev) => {
    const d = ev.properties;
    const label =
      d.newStatus === "running"
        ? "开始执行"
        : d.newStatus === "completed"
          ? "执行完成"
          : d.newStatus === "failed"
            ? "执行失败"
            : d.newStatus;
    const extra = d.newStatus === "failed" ? `: ${d.error ?? "未知错误"}` : "";
    eventBus.publish(AppEvent.Toast, {
      message: `队友 ${d.name} ${label}${extra}`,
      variant: d.newStatus === "failed" ? "error" : "info",
    });
  });
  onCleanup(() => {
    unsubTeamStatus();
  });

  const unsubLeaderShow = eventBus.subscribe(AppEvent.LeaderKeyShow, () => {
    setShowLeaderKeys(true);
  });
  onCleanup(() => {
    unsubLeaderShow();
  });

  const unsubLeaderHide = eventBus.subscribe(AppEvent.LeaderKeyHide, () => {
    setShowLeaderKeys(false);
  });
  onCleanup(() => {
    unsubLeaderHide();
  });

  // 监听文本选择完成事件 — 自动复制选中文本到剪贴板
  const selectionHandler = (selection: any) => {
    try {
      const selectedText = selection?.getSelectedText?.();
      if (selectedText && selectedText.trim().length > 0) {
        // 使用 OpenTUI 内置 OSC52 剪贴板优先，失败则回退到 crab clipboard
        const osc52ok = asExtendedRenderer(renderer).copyToClipboardOSC52?.(selectedText);
        if (!osc52ok) {
          import("@/ui/utils/clipboard").then(({ copyToClipboard }) => {
            copyToClipboard(selectedText);
          });
        }
        eventBus.publish(AppEvent.Toast, { message: "已复制到剪贴板", variant: "success" });
      }
    } catch {
      // 选择复制失败不中断用户操作
    }
  };
  asExtendedRenderer(renderer).on("selection", selectionHandler);
  onCleanup(() => {
    asExtendedRenderer(renderer).off?.("selection", selectionHandler);
  });

  useKeyboard((event) => {
    // [P1-T7] Ctrl+Z 挂起/恢复 TUI
    if (event.ctrl && event.key === "z") {
      if (suspended()) {
        resumeTui();
      } else {
        suspendTui();
      }
      event.stopPropagation();
      return;
    }

    const current = route.data.type;
    const handled = handleKeyEvent(event, current, eventBus);
    if (handled) event.stopPropagation();
  });

  return (
    <ErrorBoundary
      fallback={(err: Error, reset: () => void) => {
        const msg = (err.message ?? "").toLowerCase();
        let hint: string;
        if (msg.includes("config") || msg.includes("配置")) {
          hint = "可能是配置错误，请检查 ~/.crab/config.json";
        } else if (
          msg.includes("network") ||
          msg.includes("fetch") ||
          msg.includes("econnrefused") ||
          msg.includes("enotfound")
        ) {
          hint = "网络连接失败，请检查网络连接";
        } else if (msg.includes("permission") || msg.includes("权限") || msg.includes("eacces")) {
          hint = "权限不足，请检查文件权限";
        } else {
          hint = "请尝试重启应用，或查看日志获取更多信息";
        }
        return (
          <box flexGrow={1} flexDirection="column" justifyContent="center" alignItems="center" padding={1}>
            <text fg={theme.colors.error}>应用发生错误</text>
            <text fg={theme.colors.text}>{err.message}</text>
            <box marginTop={1}>
              <text fg={theme.colors.muted}>{hint}</text>
            </box>
            <box marginTop={1}>
              <text fg={theme.colors.muted}>
                {"日志目录: "}
                {getLogDir()}
              </text>
            </box>
            <box marginTop={1}>
              <text>按 Enter 返回首页</text>
            </box>
            <KeyPressReset onReset={reset} />
          </box>
        );
      }}
    >
      <KeyboardPriorityProvider>
        {/* ── 主内容层 ── */}
        <box
          flexDirection="column"
          height="100%"
          flexGrow={1}
          position="relative"
          backgroundColor={theme.colors.background}
        >
          <ToastContainer />
          {firstRun() ? <FirstRunOverlay onDismiss={dismissFirstRun} /> : null}
          <box flexGrow={1}>
            <Switch>
              <Match when={route.data.type === "home"}>
                <Home />
              </Match>
              <Match when={sessionRoute()}>
                {(rd: () => Extract<Route, { type: "session" }>) => <SessionWrapper sessionID={rd().sessionId} />}
              </Match>
              <Match when={route.data.type === "settings"}>
                <Settings />
              </Match>
              <Match when={route.data.type === "help"}>
                <Help />
              </Match>
              <Match when={route.data.type === "mcp"}>
                <McpPage />
              </Match>
              <Match when={route.data.type === "pixel-editor"}>
                <PixelEditor />
              </Match>
              <Match when={pluginRoute()}>
                {(rd: () => Extract<Route, { type: "plugin" }>) => <PluginRoute route={rd()} />}
              </Match>
            </Switch>
          </box>
          <WhichKeyPanel bindings={LEADER_KEY_BINDINGS} visible={showLeaderKeys()} />
          <DialogRoot />
          <Switch>
            <Match when={route.data.type === "home"}>
              <Slot name="app_bottom">
                <ResourceUsageStatus />
              </Slot>
            </Match>
            <Match when={true}>
              <Slot name="app_bottom">
                <StatusBar />
              </Slot>
            </Match>
          </Switch>
          <Slot name="app">{null}</Slot>
        </box>
      </KeyboardPriorityProvider>
    </ErrorBoundary>
  );
}
