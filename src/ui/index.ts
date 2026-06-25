// src/ui/index.ts
// UI module public API entry point

// ─── Types ──────────────────────────────────────────────────
export type { KeyboardEventLike } from "./types";

// ─── Esc Behavior ───────────────────────────────────────────
export {
  resolveEscape,
  defaultEscContext,
  resolveHistoryDirection,
  resolveSessionEscapeBehavior,
  registerEscBehavior,
  getEscBehavior,
  ESC_BEHAVIORS,
} from "./escBehavior";
export type { EscContext, EscAction, EscBehaviorName, EscBehavior, InputMode, SessionEscapeState } from "./escBehavior";

// ─── Keyboard ─────────────────────────────────────────────────
export { KeyboardPriorityProvider, useKeyboardPriority, KeyboardPriority } from "./keyboardPriority";
export type { KeyboardEventLike as PriorityKeyboardEventLike } from "./keyboardPriority";

// ─── Keymap ───────────────────────────────────────────────────
export {
  CrabKeymapProvider,
  useCrabKeymap,
  useBindings,
  useKeymapSelector,
  registerCrabKeymap,
  useCommandShortcut,
  useCrabModeStack,
  getCrabModeStack,
  createCrabModeStack,
  useCurrentMode,
  useLeaderActive,
  leaderWaiting,
  APP_COMMANDS,
  INPUT_COMMANDS,
  CRAB_LEADER_TOKEN,
  CRAB_BASE_MODE,
} from "./keymap";
export type { CrabOpenTuiKeymap, CrabModeStack } from "./keymap";

// ─── Throttle Queue (re-export from core) ─────────────────────
export {
  ThrottlePriority,
  ThrottleQueue,
  createThrottleQueue,
  createLogThrottleQueue,
  createHighPriorityThrottleQueue,
  createThrottleDecorator,
} from "./throttleQueue";
export type { ThrottleItem, ThrottleConfig } from "./throttleQueue";

// ─── Hooks (re-export from hooks/) ────────────────────────────
export { usePanelState, useCursorHide, useTerminalTitle } from "./hooks";
export type { PanelStateActions } from "./hooks";

// ─── Utils ────────────────────────────────────────────────────
// Note: Most utils are UI-specific and not re-exported here.
// Import them directly from "@/ui/utils/xxx" when needed.
