/**
 * 键盘优先级 Provider — 按优先级分发键盘事件，高优先级处理器可 stopPropagation 阻断后续。
 *
 * 职责:
 *   - 注册按优先级排序的键盘处理器
 *   - 在事件触发时按优先级从高到低调用每个处理器
 *   - 支持当前处理器通过 stopPropagation 阻止后续处理器触发
 *
 * 模块功能:
 *   - KeyboardPriorityProvider: 全局 Provider，收集所有处理器
 *   - useKeyboardPriority: Hook，注册指定优先级的处理器
 *   - KeyboardPriority: 预设优先级常量
 *
 * 使用场景:
 *   - 权限弹窗、对话框等高优先级场景需要抢占低优先级组件的按键
 *   - 多层嵌套组件需要按层级处理快捷键
 *
 * 边界:
 *   1. 优先级数值越大越先处理
 *   2. 一旦处理器调用 stopPropagation 立即停止分发
 *   3. 处理器返回的清理函数在组件卸载时自动调用
 */
import { type ParentProps, createContext, onCleanup, onMount, useContext } from "solid-js";
import { useKeyboard } from "@opentui/solid";

export interface KeyboardEventLike {
  name: string;
  ctrl: boolean;
  shift: boolean;
  meta: boolean;
  alt: boolean;
  stopPropagation: () => void;
  preventDefault: () => void;
  propagationStopped?: boolean;
  defaultPrevented?: boolean;
}

interface PriorityHandler {
  priority: number;
  label: string;
  handler: (event: KeyboardEventLike) => void;
}

const KeyboardPriorityContext = createContext<{
  register: (h: PriorityHandler) => () => void;
}>();

export function KeyboardPriorityProvider(props: ParentProps) {
  const entries: PriorityHandler[] = [];

  useKeyboard((rawEvent: any) => {
    const sorted = [...entries].toSorted((a, b) => b.priority - a.priority);
    for (const entry of sorted) {
      entry.handler(rawEvent);
      if (rawEvent.propagationStopped) {
        break;
      }
    }
  });

  const register = (h: PriorityHandler): (() => void) => {
    entries.push(h);
    return () => {
      const idx = entries.indexOf(h);
      if (idx !== -1) {
        entries.splice(idx, 1);
      }
    };
  };

  return <KeyboardPriorityContext.Provider value={{ register }}>{props.children}</KeyboardPriorityContext.Provider>;
}

export function useKeyboardPriority(
  priority: number,
  label: string,
  handler: (event: KeyboardEventLike) => void,
): void {
  const ctx = useContext(KeyboardPriorityContext);

  onMount(() => {
    if (!ctx) {
      return;
    }
    const unsub = ctx.register({ handler, label, priority });
    onCleanup(() => unsub());
  });
}

export const KeyboardPriority = {
  APP_KEYBINDS: 600,
  COMPONENT: 500,
  DIALOG_ROOT: 900,
  INPUT_MODE: 800,
  PERMISSION: 1000,
  SESSION_PAGE: 700,
} as const;
