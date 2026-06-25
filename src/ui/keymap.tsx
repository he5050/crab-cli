/**
 * [键盘映射系统]
 *
 * 职责:
 *   - 使用 @opentui/keymap 创建结构化按键绑定
 *   - 注册应用级和 Session 级命令
 *   - 提供 useCommandShortcut / useBindings hook
 *   - 支持按键别名扩展(如 enter → return)
 *   - 集成 OpenTUI 内置 keymap 插件
 *   - 多模式键位栈(createModeStack push/pop)
 *   - Leader 键支持(registerTimedLeader)
 *   - addon: backspacePopsPendingSequence / escapeClearsPendingSequence
 *
 * 模块功能:
 *   - KeymapProvider 包装器导出(CrabKeymapProvider)
 *   - 按键别名注册(KEY_ALIASES 映射)
 *   - 应用命令定义(APP_COMMANDS 常量)
 *   - Keymap 注册与清理(registerCrabKeymap)
 *   - 快捷键显示文本查询(useCommandShortcut)
 *   - 多模式栈(createCrabModeStack / useCrabModeStack)
 *   - Leader 键激活状态(useLeaderActive)
 *
 * 使用场景:
 *   - 应用启动时注册全局按键绑定
 *   - 组件内查询命令的快捷键显示
 *   - 需要自定义按键别名时
 *   - 管理输入框层级的按键行为
 *   - 弹窗/对话框进入 modal 模式时 push/pop
 *   - Leader 键等待第二键时显示提示
 *
 * 边界:
 *   1. 依赖 @opentui/keymap 库，需先初始化 renderer
 *   2. 按键别名仅支持预定义的 KEY_ALIASES 映射
 *   3. 命令绑定在 registerCrabKeymap 时一次性注册
 *   4. useCommandShortcut 返回 Accessor，需在 Solid 响应式上下文使用
 *   5. 模式栈通过 keymap.setData/getData 维护，非响应式；需配合 useKeymapSelector 读取
 *
 * 流程:
 *   1. 创建 OpenTUI keymap 实例(createDefaultOpenTuiKeymap)
 *   2. 调用 registerCrabKeymap 注册按键绑定和扩展器(含模式栈和 Leader 键)
 *   3. 使用 CrabKeymapProvider 包裹应用组件树
 *   4. 子组件通过 useCrabKeymap / useBindings 访问 keymap
 *   5. 组件通过 useCommandShortcut 查询快捷键显示文本
 *   6. 弹窗组件通过 useCrabModeStack().push("modal") 进入模式
 *   7. 应用退出时调用 registerCrabKeymap 返回的 cleanup 函数
 *
 */
import * as addons from "@opentui/keymap/addons/opentui";
import { stringifyKeyStroke, type KeyLike } from "@opentui/keymap";
import { KeymapProvider, useBindings, useKeymap, useKeymapSelector } from "@opentui/keymap/solid";
import { createSignal, type Accessor } from "solid-js";

// ─── 导出 ──────────────────────────────────────────────────────

export const CrabKeymapProvider = KeymapProvider;
export const useCrabKeymap = useKeymap;
export { useBindings, useKeymapSelector };

export type CrabOpenTuiKeymap = ReturnType<typeof useKeymap>;

// ─── 模式栈常量 ────────────────────────────────────────────────

/** Leader 键 token 名称，用于 <leader> 占位符解析 */
export const CRAB_LEADER_TOKEN = "leader";
/** 基础模式名称 */
export const CRAB_BASE_MODE = "base";
/** keymap.setData 中存储当前模式的 key */
const CRAB_MODE_KEY = "crab.mode";
/** Leader 键超时时间(ms) */
const CRAB_LEADER_TIMEOUT_MS = 1500;

// ─── 模式栈类型 ────────────────────────────────────────────────

/** 模式栈 API */
export interface CrabModeStack {
  /** 获取当前模式名 */
  current(): string;
  /** 进入新模式，返回退出函数 */
  push(mode: string): () => void;
  /** 销毁模式栈 */
  dispose(): void;
}

interface CrabModeStackEntry {
  id: symbol;
  mode: string;
}

/** keymap → modeStack 的映射，用于跨组件获取同一个栈实例 */
const modeStacks = new WeakMap<CrabOpenTuiKeymap, CrabModeStack>();

/**
 * 创建模式栈。
 *
 * 维护一个模式栈（base 模式 + 自定义模式 push/pop）。
 * 通过 keymap.setData 将当前模式写入 keymap data，
 * 配合 registerLayerFields 的 mode 字段实现 layer 级模式过滤。
 */
export function createCrabModeStack(keymap: CrabOpenTuiKeymap): CrabModeStack {
  keymap.setData(CRAB_MODE_KEY, CRAB_BASE_MODE);

  const offFields = keymap.registerLayerFields({
    mode(value: unknown, ctx: any) {
      ctx.require(CRAB_MODE_KEY, value);
    },
  });

  const stack: CrabModeStackEntry[] = [];
  let disposed = false;

  const update = () => {
    keymap.setData(CRAB_MODE_KEY, stack.at(-1)?.mode ?? CRAB_BASE_MODE);
  };

  const stackApi: CrabModeStack = {
    current() {
      return stack.at(-1)?.mode ?? CRAB_BASE_MODE;
    },
    push(mode: string) {
      if (disposed) {
        return () => {};
      }
      const id = Symbol(mode);
      let active = true;
      stack.push({ id, mode });
      update();
      return () => {
        if (!active) {
          return;
        }
        active = false;
        const index = stack.findIndex((item) => item.id === id);
        if (index !== -1) {
          stack.splice(index, 1);
        }
        update();
      };
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      stack.length = 0;
      offFields();
      keymap.setData(CRAB_MODE_KEY, undefined);
      modeStacks.delete(keymap);
    },
  };

  modeStacks.set(keymap, stackApi);
  return stackApi;
}

/** 在 Solid 组件中获取模式栈 */
export function useCrabModeStack(): CrabModeStack {
  return getCrabModeStack(useCrabKeymap());
}

/** 通过 keymap 实例获取模式栈 */
export function getCrabModeStack(keymap: CrabOpenTuiKeymap): CrabModeStack {
  const value = modeStacks.get(keymap);
  if (!value) {
    throw new Error("Crab mode stack is not registered for this keymap");
  }
  return value;
}

/** 响应式获取当前模式名 */
export function useCurrentMode(): Accessor<string> {
  return useKeymapSelector(
    (keymap: CrabOpenTuiKeymap) => (keymap.getData(CRAB_MODE_KEY) as string | undefined) ?? CRAB_BASE_MODE,
  );
}

// ─── Leader 键 ─────────────────────────────────────────────────

/**
 * 从 APP_COMMANDS 中解析 Leader 键的触发键。
 * APP_COMMANDS.leader 的值如 "Ctrl+X"。
 */
function resolveLeaderKey(): KeyLike | undefined {
  const raw = APP_COMMANDS.leader;
  if (!raw || raw === "none") {
    return undefined;
  }
  // 取第一个绑定（可能为逗号分隔的多绑定）
  const first = raw.split(",")[0]?.trim();
  return first || undefined;
}

/**
 * 响应式检测 Leader 键是否处于等待状态。
 * 当用户按下 Leader 键后、按下第二键或超时前返回 true。
 */
export function useLeaderActive(): Accessor<boolean> {
  return useKeymapSelector(
    (keymap: CrabOpenTuiKeymap) => keymap.getPendingSequence()[0]?.tokenName === CRAB_LEADER_TOKEN,
  );
}

// ─── Leader 等待提示信号 ───────────────────────────────────────

/** 全局 Leader 等待状态信号，供状态栏等非 keymap 上下文使用 */
const [leaderWaiting, setLeaderWaiting] = createSignal(false);
export { leaderWaiting };

// ─── 按键别名 ──────────────────────────────────────────────────

const KEY_ALIASES = {
  enter: "return",
  esc: "escape",
  pgdown: "pagedown",
  pgup: "pageup",
} as const;

function expandKeyAliases(input: string) {
  const result = Object.entries(KEY_ALIASES).reduce(
    (acc, [alias, key]) => acc.replace(new RegExp(`(^|[+,\\s>])${alias}(?=$|[+,\\s<])`, "gi"), `$1${key}`),
    input,
  );
  if (result === input) {
    return;
  }
  return result;
}

function registerKeyAliases(keymap: CrabOpenTuiKeymap) {
  return keymap.appendBindingExpander((ctx: any) => {
    const key = expandKeyAliases(ctx.input);
    if (!key) {
      return;
    }
    return [{ displays: ctx.displays, key }];
  });
}

// ─── 输入命令 ──────────────────────────────────────────────────

const inputCommands = [
  "history.previous",
  "history.next",
  "input.move.left",
  "input.move.right",
  "input.move.up",
  "input.move.down",
  "input.select.left",
  "input.select.right",
  "input.select.up",
  "input.select.down",
  "input.line.home",
  "input.line.end",
  "input.select.line.home",
  "input.select.line.end",
  "input.visual.line.home",
  "input.visual.line.end",
  "input.select.visual.line.home",
  "input.select.visual.line.end",
  "input.buffer.home",
  "input.buffer.end",
  "input.select.buffer.home",
  "input.select.buffer.end",
  "input.delete.line",
  "input.delete.to.line.end",
  "input.delete.to.line.start",
  "input.backspace",
  "input.delete",
  "input.newline",
  "input.undo",
  "input.redo",
  "input.word.forward",
  "input.word.backward",
  "input.select.word.forward",
  "input.select.word.backward",
  "input.delete.word.forward",
  "input.delete.word.backward",
  "input.select.all",
  "input.submit",
] as const;

// ─── 应用命令定义 ──────────────────────────────────────────────

export const APP_COMMANDS = {
  "agent.cycle": "Tab",
  "agent.cycle.reverse": "Shift+Tab",
  "agent.list": "<leader>a",
  "app.command": "Ctrl+P",
  "app.console": "none",
  "app.debug": "none",
  "app.exit": "Ctrl+C, Ctrl+D, <leader>q",
  "app.heap_snapshot": "none",
  "app.toggle.animations": "none",
  "app.toggle.diffwrap": "none",
  "app.toggle.file_context": "none",
  "app.toggle.paste_summary": "none",
  "app.toggle.session_directory_filter": "none",
  "console.org.switch": "none",
  "diff.close": "q, Esc",
  "diff.collapse": "Left",
  "diff.expand": "Right",
  "diff.expand_all": "E",
  "diff.focus_next": "Tab",
  "diff.help": "?",
  "diff.mark_reviewed": "m",
  "diff.next_file": "n",
  "diff.previous_file": "p",
  "diff.reviewed": "m",
  "diff.single_patch": "s",
  "diff.switch_source": "d",
  "diff.toggle": "Enter, Space",
  "diff.toggle_tree": "b",
  "diff.toggle_view": "v",
  "docs.open": "none",
  "help.show": "none",
  leader: "Ctrl+X",
  "mcp.list": "none",
  "messages.copy": "<leader>y",
  "model.cycle_favorite": "none",
  "model.cycle_favorite_reverse": "none",
  "model.cycle_recent": "F2",
  "model.cycle_recent_reverse": "Shift+F2",
  "model.dialog.favorite": "Ctrl+F",
  "model.dialog.provider": "Ctrl+A",
  "model.list": "<leader>m",
  "crab.status": "<leader>s",
  "plugins.install": "none",
  "plugins.list": "none",
  "prompt.clear": "Ctrl+C",
  "prompt.editor": "<leader>e",
  "prompt.editor_context.clear": "none",
  "prompt.paste": "Ctrl+V",
  "prompt.skills": "none",
  "prompt.stash": "none",
  "prompt.stash.list": "none",
  "prompt.stash.pop": "none",
  "prompt.submit": "none",
  "provider.connect": "none",
  "session.child.first": "<leader>down",
  "session.child.next": "Right",
  "session.child.previous": "Left",
  "session.compact": "<leader>c",
  "session.copy": "none",
  "session.delete": "Ctrl+D",
  "session.export": "<leader>x",
  "session.first": "Ctrl+G, Home",
  "session.fork": "none",
  "session.half.page.down": "Ctrl+Alt+D",
  "session.half.page.up": "Ctrl+Alt+U",
  "session.interrupt": "Esc",
  "session.last": "Ctrl+Alt+G, End",
  "session.line.down": "Ctrl+Alt+E",
  "session.line.up": "Ctrl+Alt+Y",
  "session.list": "<leader>l",
  "session.message.next": "none",
  "session.message.previous": "none",
  "session.messages_last_user": "none",
  "session.new": "<leader>n",
  "session.page.down": "PageDown, Ctrl+Alt+F",
  "session.page.up": "PageUp, Ctrl+Alt+B",
  "session.parent": "Up",
  "session.pin.toggle": "Ctrl+F",
  "session.quick_switch.1": "<leader>1",
  "session.quick_switch.2": "<leader>2",
  "session.quick_switch.3": "<leader>3",
  "session.quick_switch.4": "<leader>4",
  "session.quick_switch.5": "<leader>5",
  "session.quick_switch.6": "<leader>6",
  "session.quick_switch.7": "<leader>7",
  "session.quick_switch.8": "<leader>8",
  "session.quick_switch.9": "<leader>9",
  "session.redo": "<leader>r",
  "session.rename": "Ctrl+R",
  "session.share": "none",
  "session.sidebar.toggle": "<leader>b",
  "session.timeline": "<leader>g",
  "session.toggle.actions": "none",
  "session.toggle.conceal": "<leader>h",
  "session.toggle.generic_tool_output": "none",
  "session.toggle.scrollbar": "none",
  "session.toggle.thinking": "none",
  "session.toggle.timestamps": "none",
  "session.undo": "<leader>u",
  "session.unshare": "none",
  "terminal.suspend": "Ctrl+Z",
  "terminal.title.toggle": "none",
  "theme.mode.lock": "none",
  "theme.switch": "<leader>t",
  "theme.switch_mode": "none",
  "tips.toggle": "<leader>h",
  "variant.cycle": "Ctrl+T",
  "variant.list": "none",
  "which-key.layout.toggle": "Ctrl+Alt+Shift+K",
  "which-key.pending.toggle": "Ctrl+Alt+Shift+P",
  "which-key.toggle": "Ctrl+Alt+K",
  "workspace.set": "none",
} as const;

export const INPUT_COMMANDS = inputCommands;

// ─── 注册 Keymap ──────────────────────────────────────────────

export function registerCrabKeymap(keymap: CrabOpenTuiKeymap, renderer: any) {
  // 多模式栈
  const modeStack = createCrabModeStack(keymap);

  const offCommaBindings = addons.registerCommaBindings(keymap);
  const offAliasExpander = registerKeyAliases(keymap);
  const offBaseLayout = addons.registerBaseLayoutFallback(keymap);

  // Leader 键（带超时）
  const leaderKey = resolveLeaderKey();
  const offLeader = leaderKey
    ? addons.registerTimedLeader(keymap, {
        trigger: leaderKey,
        name: CRAB_LEADER_TOKEN,
        timeoutMs: CRAB_LEADER_TIMEOUT_MS,
        onArm: () => setLeaderWaiting(true),
        onDisarm: () => setLeaderWaiting(false),
      })
    : () => {};

  // addon: ESC 清除待处理序列
  const offEscape = addons.registerEscapeClearsPendingSequence(keymap);
  // addon: Backspace 退回待处理序列
  const offBackspace = addons.registerBackspacePopsPendingSequence(keymap);

  const offInputBindings = addons.registerManagedTextareaLayer(keymap, renderer as any, {
    bindings: [],
    enabled: () => renderer.currentFocusedEditor !== null,
  });

  return () => {
    offInputBindings();
    offBackspace();
    offEscape();
    offLeader();
    offBaseLayout();
    offAliasExpander();
    offCommaBindings();
    modeStack.dispose();
    setLeaderWaiting(false);
  };
}

// ─── Hook: 获取命令快捷键显示文本 ───────────────────────────────

export function useCommandShortcut(command: string): Accessor<string> {
  return useKeymapSelector((keymap: CrabOpenTuiKeymap) => {
    const result = keymap
      .getCommandBindings({
        commands: [command],
        visibility: "registered",
      })
      .get(command)?.[0]?.sequence;
    if (!result) {
      return "";
    }
    try {
      return stringifyKeyStroke(result as any);
    } catch {
      return String(result);
    }
  });
}
