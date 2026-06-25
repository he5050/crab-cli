/**
 * UsePanelState — 面板状态管理 Hook
 *
 * 职责:
 *   - 基于 useDialog context 封装面板路由
 *   - 提供面板的打开/关闭/查询操作
 *   - 简化面板状态管理，替代多个 boolean state
 *
 * 模块功能:
 *   - open — 打开指定面板(需先在 PanelsManager 注册)
 *   - close — 关闭指定弹窗/面板
 *   - closeAll — 关闭所有面板
 *   - isRegistered — 检查面板是否已注册
 *   - isAnyPanelOpen — 检查是否有任何面板打开
 *   - openPanelCount — 获取当前打开的面板数量
 *   - 天然支持 Escape 逐层关闭(useDialog 栈机制)
 *
 * 使用场景:
 *   - 需要打开模型选择面板、设置面板等
 *   - 需要检查是否有面板打开以处理快捷键
 *   - 需要统一管理多个面板的显隐状态
 *   - 需要实现 Escape 键逐层关闭面板
 *
 * 边界:
 *   1. 面板需先在 PanelsManager 中注册(registerPanel)
 *   2. 未注册的面板调用 open 会输出警告并返回空字符串
 *   3. 依赖 useDialog context，需在 DialogProvider 内使用
 *   4. 使用弹窗栈管理，后打开的面板在栈顶
 *   5. 不提供面板内容渲染，仅管理显隐状态
 *
 * 流程:
 *   1. 获取 useDialog context
 *   2. 调用 open 时检查面板是否注册 → 调用 openPanel 打开
 *   3. 调用 close 时从 dialog 栈中移除
 *   4. 调用 closeAll 时清空整个 dialog 栈
 *   5. 通过 createMemo 计算面板状态
 */

import { createMemo } from "solid-js";
import { useDialog } from "@/ui/contexts/dialog";
import { type PanelId, isPanelRegistered, openPanel } from "@/ui/components/panelsManager";

// ─── 类型定义 ──────────────────────────────────────────────

export interface PanelStateActions {
  /** 打开指定面板 */
  open: (id: PanelId, opts?: { onClose?: () => void }) => string;
  /** 关闭指定弹窗/面板 */
  close: (id: string) => void;
  /** 关闭所有面板 */
  closeAll: () => void;
  /** 检查面板是否已注册 */
  isRegistered: (id: PanelId) => boolean;
  /** 是否有任何面板打开 */
  isAnyPanelOpen: () => boolean;
  /** 当前打开的面板数量 */
  openPanelCount: () => number;
}

// ─── usePanelState Hook ───────────────────────────────────

/**
 * 面板状态管理 Hook。
 *
 * 基于 useDialog context，提供面板的打开/关闭/查询操作。
 * 面板需先在 PanelsManager 中注册(registerPanel)。
 *
 * @example
 * ```tsx
 * const panel = usePanelState();
 *
 * // 打开模型选择面板
 * panel.open("models");
 *
 * // 检查是否有面板打开
 * if (panel.isAnyPanelOpen()) { ... }
 * ```
 */
export function usePanelState(): PanelStateActions {
  const dialog = useDialog();

  const isAnyPanelOpen = createMemo(() => dialog.stack.length > 0);
  const openPanelCount = createMemo(() => dialog.stack.length);

  return {
    close(id: string): void {
      dialog.close(id);
    },

    closeAll(): void {
      dialog.clear();
    },

    isAnyPanelOpen,

    isRegistered(id: PanelId): boolean {
      return isPanelRegistered(id);
    },

    open(id: PanelId, opts?: { onClose?: () => void }): string {
      return openPanel(dialog, id, opts);
    },

    openPanelCount,
  };
}
