/**
 * UseTerminal — 终端控制工具 Hook
 *
 * 职责:
 *   - 提供终端光标控制(隐藏/显示)
 *   - 提供终端窗口标题设置
 *   - 补充 OpenTUI 未原生提供的终端控制功能
 *
 * 模块功能:
 *   - useCursorHide — 隐藏终端光标，组件卸载时自动恢复
 *   - useTerminalTitle — 设置终端窗口/标签标题，卸载时自动清空
 *   - 使用 ANSI 转义序列直接控制终端
 *   - 使用 SolidJS onCleanup 处理资源清理
 *
 * 使用场景:
 *   - 页面切换时需要隐藏光标防止闪烁
 *   - 需要设置终端窗口标题显示应用状态
 *   - 多页面 TUI 应用中管理终端状态
 *
 * 边界:
 *   1. 仅在 TTY 环境下生效(stdout.isTTY 检查)
 *   2. useCursorHide 在组件卸载时自动恢复光标
 *   3. useTerminalTitle 在组件卸载时自动清空标题并恢复 process.title
 *   4. 不处理 OpenTUI 原生提供的功能(如 useTerminalDimensions、onResize 等)
 *   5. 跨平台兼容:Windows 使用 process.title，其他终端使用 OSC 序列
 *   6. 忽略写入失败(stdout 关闭或受限环境)
 *
 * 流程:
 *   1. useCursorHide: 写入 CSI ?25l 隐藏光标 → onCleanup 写入 CSI ?25h 恢复
 *   2. useTerminalTitle: 设置 process.title → 写入 OSC 序列 → onCleanup 恢复
 */

import { onCleanup } from "solid-js";

// ─── 光标控制 ──────────────────────────────────────────────

/**
 * 隐藏终端光标。组件卸载时自动恢复。
 *
 *
 * 用于防止页面切换时光标闪烁。
 * 光标可见性在应用退出时由 renderer cleanup 统一恢复。
 *
 * @example
 * ```tsx
 * function MyScreen() {
 *   useCursorHide();
 *   return <box>...</box>;
 * }
 * ```
 */
export function useCursorHide(): void {
  const { stdout } = process;
  if (!stdout.isTTY) {
    return;
  }

  stdout.write("\x1b[?25l"); // CSI ?25l — 隐藏光标

  onCleanup(() => {
    stdout.write("\x1b[?25h"); // CSI ?25h — 显示光标
  });
}

// ─── 终端标题 ──────────────────────────────────────────────

/**
 * 设置终端窗口/标签标题。组件卸载时自动清空。
 *
 *
 * 跨平台兼容策略:
 *   1. process.title — Windows 控制台直接生效
 *   2. OSC 转义序列 ESC]0;<title>BEL — 所有支持 ANSI 的现代终端
 *
 * @param title 要显示的标题；传入空字符串会清空标题
 *
 * @example
 * ```tsx
 * function SessionPage() {
 *   useTerminalTitle("Crab CLI - 会话");
 *   return <box>...</box>;
 * }
 * ```
 */
export function useTerminalTitle(title: string): void {
  const { stdout } = process;
  if (!stdout.isTTY) {
    return;
  }

  // 保存原 process.title 以便卸载时恢复
  let previousProcessTitle: string | undefined;
  try {
    previousProcessTitle = process.title;
  } catch {
    // 某些受限环境读取 process.title 可能抛错
  }

  // 设置 process.title(Windows 控制台直接生效)
  if (title) {
    try {
      process.title = title;
    } catch {
      // 某些平台写入 process.title 会失败
    }
  }

  // OSC 序列设置终端标题
  try {
    stdout.write(`\x1b]0;${title}\x07`);
  } catch {
    // Stdout 已关闭或不可写时忽略
  }

  onCleanup(() => {
    if (!stdout.isTTY) {
      return;
    }

    // 恢复原 process.title
    if (previousProcessTitle !== undefined) {
      try {
        process.title = previousProcessTitle;
      } catch {
        // 忽略恢复失败
      }
    }

    // 清空终端标题
    try {
      stdout.write("\x1b]0;\x07");
    } catch {
      // 卸载阶段 stdout 可能已关闭
    }
  });
}
