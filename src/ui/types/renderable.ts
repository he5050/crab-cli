/**
 * OpenTUI 可变渲染引用 — 跨组件共享的 renderable 接口。
 *
 * 职责:
 *   - 定义 MutableTextRenderable / MutableBoxRenderable 接口
 *   - 统一三处(statusBar / footer / questionEventBridge)的重复定义
 *
 * 边界:
 *   1. 仅类型定义，不含运行时逻辑
 *   2. 所有字段使用 unknown 以匹配 OpenTUI 的渲染层类型
 */

/** OpenTUI 文本渲染引用 — 可直接 mutation 更新 content 以触发重渲染。 */
export interface MutableTextRenderable {
  content: unknown;
  /** 是否可见（仅 questionEventBridge 使用） */
  visible?: boolean;
  /** 前景色（仅 questionEventBridge 使用） */
  fg?: unknown;
  /** 背景色（仅 questionEventBridge 使用） */
  bg?: unknown;
}

/** OpenTUI Box 渲染引用 — 可直接 mutation 更新可见状态。 */
export interface MutableBoxRenderable {
  visible: boolean;
  backgroundColor?: unknown;
}
