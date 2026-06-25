/**
 * 全局 UI 类型定义 — 跨模块共享的事件/输入类型。
 *
 * 职责:
 *   - 定义跨模块共享的 UI 事件类型
 *   - 提供统一的键盘事件接口(与 OpenTUI/Solid 兼容)
 */
export interface KeyboardEventLike {
  name?: string;
  key?: string;
  code?: string;
  ctrl?: boolean;
  meta?: boolean;
  alt?: boolean;
  shift?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  preventDefault?: () => void;
  stopPropagation?: () => void;
}
