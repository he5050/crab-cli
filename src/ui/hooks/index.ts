/**
 * Hooks 模块入口
 *
 * 职责:
 *   - 统一导出 UI 层自定义 Hooks
 *   - 提供面板状态管理和终端控制工具
 *   - 作为 Hooks 模块的单一入口点
 *
 * 模块功能:
 *   - 导出 usePanelState — 基于 useDialog 的面板路由管理
 *   - 导出 useCursorHide — 隐藏/显示终端光标
 *   - 导出 useTerminalTitle — 设置终端窗口标题
 *   - 导出相关类型定义
 *
 * 使用场景:
 *   - 在 UI 组件中需要管理面板状态时
 *   - 需要控制终端光标或标题时
 *   - 需要统一导入多个 Hooks 时
 *
 * 边界:
 *   1. 不导出 OpenTUI 原生 Hooks(如 useTerminalDimensions、onResize 等)
 *   2. 不负责业务逻辑 Hooks(如 useMessageUndo、useFrecency 等)
 *   3. 仅作为聚合导出层，不包含实现逻辑
 *
 * 流程:
 *   1. 从各子模块导入 Hooks 实现
 *   2. 重新导出供外部使用
 */

export { usePanelState, type PanelStateActions } from "./usePanelState";
export { useCursorHide, useTerminalTitle } from "./useTerminal";
