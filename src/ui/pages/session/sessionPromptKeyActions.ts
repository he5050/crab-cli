/**
 * 会话 Prompt 按键动作 — 将键盘事件映射为语义化动作。
 *
 * 职责:
 *   - 解析方向键/Enter/Esc 等按键
 *   - 输出 SessionPromptKeyAction 供 Prompt 组件 dispatch
 */
import type { KeyboardEventLike } from "@/ui/types";

export type SessionPromptKeyAction =
  | "autocompleteClose"
  | "autocompletePrevious"
  | "autocompleteNext"
  | "autocompleteSelect"
  | "historyPrevious"
  | "historyNext"
  | "stashCurrent"
  | "restoreLastStash"
  | "openStashList"
  | "none";

export function resolveSessionPromptKeyAction(input: {
  event: KeyboardEventLike;
  autocompleteOpen: boolean;
  cursorOffset: number;
  inputLength: number;
}): SessionPromptKeyAction {
  const { event } = input;

  if (input.autocompleteOpen) {
    if (event.name === "escape") {
      return "autocompleteClose";
    }
    if (event.name === "up" || (event.ctrl && event.name === "p")) {
      return "autocompletePrevious";
    }
    if (event.name === "down" || (event.ctrl && event.name === "n")) {
      return "autocompleteNext";
    }
    if (event.name === "tab" || event.name === "return" || event.name === "enter") {
      return "autocompleteSelect";
    }
  }

  if (event.name === "up" && input.cursorOffset === 0) {
    return "historyPrevious";
  }
  if (event.name === "down" && input.cursorOffset >= input.inputLength) {
    return "historyNext";
  }
  if (event.ctrl && event.shift && event.name === "s") {
    return "stashCurrent";
  }
  if (event.ctrl && event.shift && event.name === "r") {
    return "restoreLastStash";
  }
  if (event.ctrl && event.shift && event.name === "l") {
    return "openStashList";
  }

  return "none";
}
