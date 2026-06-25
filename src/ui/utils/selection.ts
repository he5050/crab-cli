/**
 * 选区复制工具 — 终端选区文本复制到剪贴板。
 *
 * 职责:
 *   - 从终端选区 API 获取选中文本
 *   - 写入系统剪贴板
 *   - 提供 onCopySelection 回调接口
 *
 * 模块功能:
 *   - Selection.copy(): 获取选中文本并复制到剪贴板
 *   - getSelectedText(): 从渲染器获取选中文本
 *   - onCopySelection: 复制完成回调
 *
 * 使用场景:
 *   - 鼠标选中文本后自动复制
 *   - 右键触发选区复制
 *   - 自定义复制快捷键
 *
 * 边界:
 *   1. 依赖 OpenTUI 渲染器的 selection 事件和 getSelectedText API
 *   2. 剪贴板写入优先使用 OSC52，失败回退到系统命令
 *   3. 选区为空时静默返回 false
 *
 * 流程:
 *   1. 从渲染器获取选中文本
 *   2. 文本为空则返回 false
 *   3. 调用 copyToClipboard 写入剪贴板
 *   4. 触发 onCopySelection 回调
 *   5. 返回操作结果
 */
import type { CliRenderer } from "@opentui/core";
import { copyToClipboard } from "@/ui/utils/clipboard";
import type { EventBus } from "@bus";
import { AppEvent } from "@bus";

/** 扩展渲染器类型 — 桥接选区 API */
type ExtendedRenderer = CliRenderer & {
  /** 获取当前选中文本 */
  getSelectedText?: () => string;
  /** 选区对象(可能包含 getSelectedText 方法) */
  selection?: {
    getSelectedText?: () => string;
  };
};

/** 选区复制回调 */
export type OnCopySelection = (text: string, success: boolean) => void;

/**
 * Selection 工具集 — 选区文本复制。
 */
export const Selection = {
  /**
   * 从渲染器获取当前选中文本。
   *
   * @param renderer - OpenTUI 渲染器实例
   * @returns 选中文本，无选区时返回空字符串
   */
  getSelectedText(renderer: CliRenderer | null): string {
    if (!renderer) {
      return "";
    }
    const ext = renderer as ExtendedRenderer;
    // 尝试多种选区 API 路径
    const text = ext.getSelectedText?.() ?? ext.selection?.getSelectedText?.() ?? "";
    return text.trim();
  },

  /**
   * 复制当前选中文本到剪贴板。
   *
   * @param renderer - OpenTUI 渲染器实例
   * @param onCopy - 复制完成回调(可选)
   * @param eventBus - 事件总线，用于发送 Toast 通知(可选)
   * @returns 复制是否成功
   */
  copy(renderer: CliRenderer | null, onCopy?: OnCopySelection, eventBus?: EventBus): boolean {
    const text = this.getSelectedText(renderer);
    if (!text) {
      return false;
    }

    const ok = copyToClipboard(text);

    // 触发回调
    onCopy?.(text, ok);

    // 发送 Toast 通知
    if (eventBus) {
      eventBus.publish(AppEvent.Toast, {
        message: ok ? "已复制选区到剪贴板" : "复制失败",
        variant: ok ? "success" : "error",
      });
    }

    return ok;
  },
};
