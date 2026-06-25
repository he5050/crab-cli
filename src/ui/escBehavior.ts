/**
 * Esc 语义集中表 (Escape Semantic Centralization)
 *
 * 单一决策层:给定当前的 EscContext(应用 UI 状态快照)，返回下一步应执行的
 * EscAction。**该模块是纯函数**，无任何副作用；副作用由调用方根据 action.kind
 * 自行触发(props.onClose?.() / setX(null) / globalBus.publish 等)。
 *
 * 优先级(自高到低；JSDoc 与守卫测试中均已固化):
 *   1. pendingPermission        — 权限弹窗:必须 reject，不能被其他事件覆盖
 *   2. modalStack               — 任意对话框栈顶层:先关栈
 *   3. inputMode                — 当前子模式:先退出子模式
 *   4. history                  — 历史浏览模式:Esc 不应处理(输入框内的 ↑/↓ 走
 *                                 其他事件流)，返回 none
 *   5. none                     — 无事可做，调用方继续其它处理
 *
 * @see docs/gsd.md 子阶段 B1 [P2-20]
 * @see test/24SessionEnhancements/escBehavior.test.ts
 */

/** 子模式标识(统一命名空间，调用方按需取值)。 */
export type InputMode =
  | "freeInput" // CommandArgsPanel 的自由输入
  | "selectArg" // CommandArgsPanel 的补全选择
  | "askFreeInput" // AskUserQuestion 的自由输入
  | "screenSubView" // CustomCommandPanel 的 add-name/add-cmd/add-desc 子屏
  | "history"; // 历史浏览子模式(↑/↓)

/** Esc 决策所需的最小 UI 状态快照(所有字段可选，未传视为 false/null)。 */
export interface EscContext {
  /** 是否有任何顶层对话框打开(兼容单/多对话框栈)。 */
  readonly openDialog?: boolean;
  /** 对话框栈深度(>0 表示存在待关闭的栈帧)。 */
  readonly modalStackDepth?: number;
  /** 是否存在待处理的权限请求(permissionDialog 显示中)。 */
  readonly pendingPermission?: boolean;
  /** 当前子模式；null 表示无子模式。 */
  readonly lastInputMode?: InputMode | null;
}

/** Esc 决策结果(判别联合)。 */
export type EscAction =
  | { kind: "none" } // 4/5. 无事可做
  | { kind: "closeTopDialog" } // 2. 弹顶层对话框
  | { kind: "popInputMode"; mode: InputMode } // 3. 退出子模式
  | { kind: "rejectPendingPermission" } // 1. 拒绝权限
  | { kind: "historyPrev" } // 历史浏览:↑
  | { kind: "historyNext" }; // 历史浏览:↓

/** 用户可感知的 Esc 语义名称，供页面/组件在同一张表内声明意图。 */
export type EscBehaviorName =
  | "cancel"
  | "close-overlay"
  | "abort-stream"
  | "navigate-back"
  | "clear-input"
  | "exit-mode";

export interface EscBehavior {
  name: EscBehaviorName;
  label: string;
  action: EscAction["kind"];
  priority: number;
}

export const ESC_BEHAVIORS: Readonly<Record<EscBehaviorName, EscBehavior>> = Object.freeze({
  "abort-stream": {
    action: "none",
    label: "Abort the active streaming response",
    name: "abort-stream",
    priority: 80,
  },
  cancel: {
    action: "rejectPendingPermission",
    label: "Cancel or reject the active blocking interaction",
    name: "cancel",
    priority: 100,
  },
  "clear-input": {
    action: "none",
    label: "Clear the current prompt input",
    name: "clear-input",
    priority: 30,
  },
  "close-overlay": {
    action: "closeTopDialog",
    label: "Close the top overlay or modal frame",
    name: "close-overlay",
    priority: 90,
  },
  "exit-mode": {
    action: "popInputMode",
    label: "Exit the active sub-mode",
    name: "exit-mode",
    priority: 70,
  },
  "navigate-back": {
    action: "none",
    label: "Navigate back to the previous route",
    name: "navigate-back",
    priority: 40,
  },
});

const registeredEscBehaviors = new Map<EscBehaviorName, EscBehavior>();

export function getEscBehavior(name: EscBehaviorName): EscBehavior | undefined {
  return registeredEscBehaviors.get(name) ?? ESC_BEHAVIORS[name];
}

export function registerEscBehavior(behavior: EscBehavior): () => void {
  const previous = registeredEscBehaviors.get(behavior.name);
  registeredEscBehaviors.set(behavior.name, behavior);
  return () => {
    if (previous) {
      registeredEscBehaviors.set(behavior.name, previous);
    } else {
      registeredEscBehaviors.delete(behavior.name);
    }
  };
}

export interface SessionEscapeState {
  pendingPermission?: boolean;
  loading?: boolean;
  autocompleteOpen?: boolean;
  overlayOpen?: boolean;
  inputHasValue?: boolean;
  inputMode?: InputMode | null;
}

export function resolveSessionEscapeBehavior(state: SessionEscapeState): EscBehaviorName | null {
  if (state.pendingPermission) {
    return "cancel";
  }
  if (state.loading) {
    return "abort-stream";
  }
  if (state.autocompleteOpen || state.overlayOpen) {
    return "close-overlay";
  }
  if (state.inputMode && state.inputMode !== "history") {
    return "exit-mode";
  }
  if (state.inputHasValue) {
    return "clear-input";
  }
  return null;
}

/**
 * 工厂:返回全 false/null 的 EscContext。
 * 用于"未携带上下文时"的兜底；返回 { kind: "none" }。
 */
export function defaultEscContext(): EscContext {
  return {
    lastInputMode: null,
    modalStackDepth: 0,
    openDialog: false,
    pendingPermission: false,
  };
}

/**
 * 纯决策函数:根据 ctx 决定 Esc 应触发的动作。
 *
 * 优先级(自高到低):
 *   pendingPermission > modalStack > inputMode > history > none
 *
 * @param ctx 当前 UI 状态快照
 * @returns EscAction 判别联合
 */
export function resolveEscape(ctx: EscContext): EscAction {
  // 合并 default，允许调用方传部分字段
  const c = { ...defaultEscContext(), ...ctx };
  // 1. 权限弹窗:最高优先级
  if (c.pendingPermission) {
    return { kind: "rejectPendingPermission" };
  }

  // 2. 对话框栈:先关栈
  if (c.openDialog || (c.modalStackDepth ?? 0) > 0) {
    return { kind: "closeTopDialog" };
  }

  // 3. 子模式:先退出子模式(history 子模式在第 4 步单独处理)
  if (c.lastInputMode !== null && c.lastInputMode !== undefined && c.lastInputMode !== "history") {
    return { kind: "popInputMode", mode: c.lastInputMode };
  }

  // 4. 历史浏览:默认 prev(调用方按事件流覆盖为 next)
  if (c.lastInputMode === "history") {
    return { kind: "historyPrev" };
  }

  // 5. 兜底
  return { kind: "none" };
}

/**
 * 历史浏览模式下的方向判定:把 "up"/"down" 翻译成 historyPrev/Next。
 * 独立成函数是因为该判定依赖具体按键流，无法在 resolveEscape 内部完成。
 *
 * @param dir 方向键的 event.name("up" | "down")，不区分大小写
 * @returns EscAction 判别联合
 */
export function resolveHistoryDirection(dir: string | undefined): EscAction {
  if (dir === "down") {
    return { kind: "historyNext" };
  }
  return { kind: "historyPrev" };
}
