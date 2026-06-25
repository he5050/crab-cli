/**
 * 全局键盘快捷键模块
 *
 * 职责:
 *   - 集中管理所有键盘快捷键
 *   - 提供统一的快捷键查询和处理
 *   - 支持页面限定的快捷键
 *
 * 模块功能:
 *   - 注册全局快捷键
 *   - 处理键盘事件匹配
 *   - 页面限定快捷键支持
 *   - 获取快捷键描述(用于帮助文档)
 *   - 注册应用级默认快捷键
 *
 * 使用场景:
 *   - TUI 应用全局快捷键管理
 *   - 命令面板(Ctrl+P)
 *   - 页面导航(Esc 返回、Enter 新建会话)
 *   - 主题切换(Ctrl+T)
 *   - 帮助页面(?)
 *
 * 边界:
 *   1. 仅定义快捷键映射和处理逻辑，不包含具体业务实现
 *   2. 快捷键处理按注册顺序匹配，第一个匹配的执行
 *   3. 支持页面限定(pages 字段)，未指定则全局生效
 *   4. 不处理按键的底层读取(由上层组件提供事件)
 *   5. 快捷键描述用于帮助文档展示
 *
 * 流程:
 *   1. 注册快捷键(match 函数 + handler + description)
 *   2. 键盘事件发生时调用 handleKeyEvent
 *   3. 遍历注册表，按顺序匹配快捷键
 *   4. 检查页面限定条件
 *   5. 执行匹配的 handler
 *   6. 返回是否已处理
 */
import { globalBus, type EventBus } from "@/bus";
import { AppEvent } from "@/bus";
import { getLogDir } from "@/core/logging/logStore";
import os from "node:os";
import fs from "node:fs";
import { exec } from "node:child_process";
import type { KeyboardEventLike } from "@/ui/types";

/** 快捷键处理函数 */
type KeybindHandler = (event: KeyboardEventLike, currentPage: string) => void;

/** 快捷键映射 */
interface KeyBinding {
  /** 快捷键匹配条件 */
  match: (event: KeyboardEventLike) => boolean;
  /** 处理函数 */
  handler: KeybindHandler;
  /** 描述(用于文档和调试) */
  description: string;
  /** 限定生效页面(空=全局) */
  pages?: string[];
}

/** 快捷键注册表 */
const keybinds: KeyBinding[] = [];
let pendingLeader = false;
let leaderTimer: ReturnType<typeof setTimeout> | undefined;

function clearLeader(eventBus: EventBus = globalBus): void {
  const wasPending = pendingLeader;
  pendingLeader = false;
  if (leaderTimer) {
    clearTimeout(leaderTimer);
    leaderTimer = undefined;
  }
  if (wasPending) {
    eventBus.publish(AppEvent.LeaderKeyHide, {});
  }
}

function enterLeader(): void {
  clearLeader();
  pendingLeader = true;
  leaderTimer = setTimeout(() => {
    clearLeader();
  }, 3000);
  if (leaderTimer.unref) {
    leaderTimer.unref();
  }
}

function leaderKey(event: KeyboardEventLike): string | undefined {
  if (event.ctrl || event.meta || event.alt) {
    return undefined;
  }
  return typeof event.name === "string" ? event.name.toLowerCase() : undefined;
}

/**
 * 注册全局快捷键。
 */
function registerKeybind(mapping: KeyBinding): void {
  keybinds.push(mapping);
}

/**
 * 处理键盘事件。
 * 按注册顺序匹配，第一个匹配的快捷键会被执行。
 * @returns 是否已处理该事件
 */
export function handleKeyEvent(event: KeyboardEventLike, currentPage: string, eventBus: EventBus = globalBus): boolean {
  if (pendingLeader) {
    if (KEY_MATCHERS.escape(event)) {
      clearLeader(eventBus);
      return true;
    }
    const key = leaderKey(event);
    if (key) {
      const handler = leaderHandlers[key];
      clearLeader(eventBus);
      if (handler) {
        handler(event, currentPage);
      } else {
        eventBus.publish(AppEvent.Toast, { message: `未知快捷键: Ctrl+X ${key}`, variant: "warning" });
      }
      return true;
    }
  }

  for (const keybind of keybinds) {
    if (keybind.match(event)) {
      if (shouldHandleOnPage(keybind, currentPage)) {
        keybind.handler(event, currentPage);
        return true;
      }
    }
  }
  return false;
}

/**
 * 判断快捷键是否应该在当前页面生效。
 */
function shouldHandleOnPage(keybind: KeyBinding, currentPage: string): boolean {
  if (keybind.pages && keybind.pages.length > 0) {
    return keybind.pages.includes(currentPage);
  }
  return true; // 未指定页面则全局生效
}

/**
 * 获取所有快捷键的描述(用于帮助文档)。
 */
export function getKeybinds(): { keys: string; description: string; pages?: string[] }[] {
  return keybinds.map((k) => ({
    description: k.description,
    keys: getKeysDescription(k.match),
    pages: k.pages,
  }));
}

/**
 * 获取快捷键的可读描述。
 */
function getKeysDescription(match: (event: KeyboardEventLike) => boolean): string {
  for (const [keys, desc] of Object.entries(KEY_DESCRIPTIONS)) {
    if (match === KEY_MATCHERS[keys as keyof typeof KEY_MATCHERS]) {
      return desc;
    }
  }
  return "";
}

/** 快捷键匹配器 */
const KEY_MATCHERS = {
  ctrlC: (e: KeyboardEventLike) => Boolean(e.ctrl) && e.name === "c",
  ctrlD: (e: KeyboardEventLike) => Boolean(e.ctrl) && e.name === "d",
  ctrlL: (e: KeyboardEventLike) => Boolean(e.ctrl) && e.name === "l",
  ctrlP: (e: KeyboardEventLike) => Boolean(e.ctrl) && e.name === "p",
  ctrlT: (e: KeyboardEventLike) => Boolean(e.ctrl) && e.name === "t",
  ctrlX: (e: KeyboardEventLike) => Boolean(e.ctrl) && e.name === "x",
  enter: (e: KeyboardEventLike) => e.name === "return" || e.name === "enter",
  escape: (e: KeyboardEventLike) => e.name === "escape",
  m: (e: KeyboardEventLike) => e.name === "m" && !e.ctrl && !e.meta,
  question: (e: KeyboardEventLike) => e.name === "?" && !e.ctrl && !e.meta,
  s: (e: KeyboardEventLike) => e.name === "s" && !e.ctrl && !e.meta,
};

/** 快捷键描述 */
const KEY_DESCRIPTIONS: Record<string, string> = {
  ctrlC: "Ctrl+C",
  ctrlD: "Ctrl+D",
  ctrlL: "Ctrl+L",
  ctrlP: "Ctrl+P",
  ctrlT: "Ctrl+T",
  ctrlX: "Ctrl+X",
  enter: "Enter",
  escape: "Esc",
  m: "M",
  question: "?",
  s: "S",
};

/**
 * 注册所有应用级快捷键。
 */
export function registerAppKeybinds(
  handlers: {
    showCommandPalette: () => void;
    showLeaderHint?: () => void;
    openLogDir: () => void;
    navigateBack: () => void;
    createSession: () => void;
    navigateToSettings: () => void;
    navigateToHelp: () => void;
    navigateToMcp: () => void;
    cycleTheme: () => void;
    showSessionList?: () => void;
    showThemePicker?: () => void;
    showModelPicker?: () => void;
    showAgentPicker?: () => void;
    showStatusDialog?: () => void;
    toggleSidebar?: () => void;
    showTimeline?: () => void;
    compactSession?: () => void;
    exportSession?: () => void;
    requestExit?: () => void;
    copyLastMessage?: () => void;
    undoMessage?: () => void;
    redoMessage?: () => void;
    toggleConceal?: () => void;
    quickSwitchSession?: (slot: number) => void;
  },
  eventBus: EventBus = globalBus,
): void {
  keybinds.length = 0;
  clearLeader(eventBus);

  const sessionOnly = (currentPage: string, action: () => void, label: string) => {
    if (currentPage === "session") {
      action();
      return;
    }
    eventBus.publish(AppEvent.Toast, { message: `${label} 只在 Session 页面可用`, variant: "info" });
  };

  leaderHandlers = {
    a: () => handlers.showAgentPicker?.(),
    b: (_event, currentPage) => {
      if (currentPage === "session") {
        handlers.toggleSidebar?.();
      } else {
        eventBus.publish(AppEvent.Toast, { message: "Sidebar 只在 Session 页面可用", variant: "info" });
      }
    },
    c: () => handlers.compactSession?.(),
    g: (_event, currentPage) => {
      if (currentPage === "session") {
        handlers.showTimeline?.();
      } else {
        eventBus.publish(AppEvent.Toast, { message: "Timeline 只在 Session 页面可用", variant: "info" });
      }
    },
    h: (_event, currentPage) => sessionOnly(currentPage, () => handlers.toggleConceal?.(), "隐藏/显示内容"),
    l: () => handlers.showSessionList?.(),
    m: () => handlers.showModelPicker?.(),
    n: () => handlers.createSession(),
    q: () => handlers.requestExit?.(),
    r: (_event, currentPage) => sessionOnly(currentPage, () => handlers.redoMessage?.(), "恢复消息"),
    s: () => handlers.showStatusDialog?.(),
    t: () => handlers.showThemePicker?.(),
    u: (_event, currentPage) => sessionOnly(currentPage, () => handlers.undoMessage?.(), "撤销消息"),
    x: () => handlers.exportSession?.(),
    y: (_event, currentPage) => sessionOnly(currentPage, () => handlers.copyLastMessage?.(), "复制消息"),
  };
  for (let slot = 1; slot <= 9; slot++) {
    leaderHandlers[String(slot)] = () => handlers.quickSwitchSession?.(slot);
  }

  registerKeybind({
    description: "搜索命令...",
    handler: () => handlers.showCommandPalette(),
    match: KEY_MATCHERS.ctrlP,
  });

  registerKeybind({
    description: "Leader 快捷键",
    handler: () => {
      enterLeader();
      handlers.showLeaderHint?.();
    },
    match: KEY_MATCHERS.ctrlX,
  });

  registerKeybind({
    description: "退出应用",
    handler: () => handlers.requestExit?.(),
    match: KEY_MATCHERS.ctrlC,
  });

  registerKeybind({
    description: "退出应用",
    handler: () => handlers.requestExit?.(),
    match: KEY_MATCHERS.ctrlD,
  });

  registerKeybind({
    description: "打开日志目录",
    handler: () => handlers.openLogDir(),
    match: KEY_MATCHERS.ctrlL,
    pages: ["home", "settings", "mcp"],
  });

  registerKeybind({
    description: "返回",
    handler: () => {
      clearLeader();
      handlers.navigateBack();
    },
    match: KEY_MATCHERS.escape,
  });

  registerKeybind({
    description: "新建会话",
    handler: () => handlers.createSession(),
    match: KEY_MATCHERS.enter,
    pages: ["home"],
  });

  registerKeybind({
    description: "设置页",
    handler: () => handlers.navigateToSettings(),
    match: KEY_MATCHERS.s,
    pages: ["home"],
  });

  registerKeybind({
    description: "帮助页",
    handler: () => handlers.navigateToHelp(),
    match: KEY_MATCHERS.question,
  });

  registerKeybind({
    description: "MCP 管理",
    handler: () => handlers.navigateToMcp(),
    match: KEY_MATCHERS.m,
    pages: ["home"],
  });

  registerKeybind({
    description: "主题选择",
    handler: () => handlers.cycleTheme(),
    match: KEY_MATCHERS.ctrlT,
  });
}

/** 默认快捷键处理函数 */
export function createDefaultHandlers(deps: {
  getLogDir: () => string;
  exec: typeof exec;
  os: typeof os;
  fs: typeof fs;
  eventBus: EventBus;
  AppEvent: typeof AppEvent;
  routeBack: () => void;
  createSession: () => void;
  navigateToSettings: () => void;
  navigateToHelp: () => void;
  navigateToMcp: () => void;
  cycleTheme: () => void;
  requestExit?: () => void;
  quickSwitchSession?: (slot: number) => void;
}) {
  return {
    compactSession: () => {
      void import("@/commandPalette/registry").then(({ getCommandRegistry }) => {
        void getCommandRegistry().executeSlash("compact");
      });
    },
    copyLastMessage: () => {
      deps.eventBus.publish(AppEvent.CopyLastMessage, {});
    },
    createSession: () => {
      deps.createSession();
    },
    cycleTheme: () => {
      deps.cycleTheme();
    },
    exportSession: () => {
      void import("@/commandPalette/registry").then(({ getCommandRegistry }) => {
        void getCommandRegistry().executeSlash("export");
      });
    },
    navigateBack: () => {
      deps.routeBack();
    },
    navigateToHelp: () => {
      deps.navigateToHelp();
    },
    navigateToMcp: () => {
      deps.navigateToMcp();
    },
    navigateToSettings: () => {
      deps.navigateToSettings();
    },
    openLogDir: () => {
      const dir = getLogDir();
      fs.mkdirSync(dir, { recursive: true });
      const openCmd = os.platform() === "darwin" ? "open" : os.platform() === "win32" ? "start" : "xdg-open";
      exec(`${openCmd} ${os.platform() === "win32" ? '""' : ""} "${dir}"`);
    },
    quickSwitchSession: (slot: number) => {
      if (deps.quickSwitchSession) {
        deps.quickSwitchSession(slot);
        return;
      }
      deps.eventBus.publish(AppEvent.SessionQuickSwitchRequested, { slot });
    },
    redoMessage: () => {
      deps.eventBus.publish(AppEvent.SessionRedoRequested, {});
    },
    requestExit: () => {
      deps.requestExit?.();
    },
    showAgentPicker: () => {
      deps.eventBus.publish(AppEvent.AgentPickerShow, {});
    },
    showCommandPalette: () => {
      deps.eventBus.publish(AppEvent.CommandPaletteShow, { query: "" });
    },
    showLeaderHint: () => {
      deps.eventBus.publish(AppEvent.LeaderKeyShow, {});
    },
    showModelPicker: () => {
      deps.eventBus.publish(AppEvent.ModelPickerShow, {});
    },
    showSessionList: () => {
      deps.eventBus.publish(AppEvent.SessionListShow, {});
    },
    showStatusDialog: () => {
      deps.eventBus.publish(AppEvent.StatusDialogShow, {});
    },
    showThemePicker: () => {
      deps.eventBus.publish(AppEvent.ThemePickerShow, {});
    },
    showTimeline: () => {
      deps.eventBus.publish(AppEvent.TimelineShow, {});
    },
    toggleConceal: () => {
      deps.eventBus.publish(AppEvent.SessionToggleConceal, {});
    },
    toggleSidebar: () => {
      deps.eventBus.publish(AppEvent.SessionSidebarToggle, {});
    },
    undoMessage: () => {
      deps.eventBus.publish(AppEvent.SessionUndoRequested, {});
    },
  };
}

let leaderHandlers: Record<string, KeybindHandler> = {};
