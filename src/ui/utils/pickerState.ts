/**
 * 选择器状态模块
 *
 * 职责:
 *   - 跨组件 ESC 键协调的共享状态
 *   - 解决多个键盘处理器同时响应同一按键的问题
 *   - 提供选择器面板活动状态管理
 *
 * 模块功能:
 *   - 设置选择器面板活动状态(setPickerActive)
 *   - 检查选择器面板是否处于活动状态(isPickerActive)
 *
 * 使用场景:
 *   - SkillsPicker 面板打开时标记活动状态
 *   - ChatInput 在显示面板时设置活动标志
 *   - ChatScreen 在处理 ESC 前检查活动标志
 *   - 防止 ESC 键被多个处理器同时响应
 *
 * 边界:
 *   1. 使用全局变量存储状态，适用于单例模式
 *   2. 不处理具体的 ESC 键逻辑，仅提供状态标志
 *   3. 需要组件显式设置和检查状态
 *   4. 状态不持久化，应用重启后重置
 *
 * 流程:
 *   1. 选择器面板打开时调用 setPickerActive(true)
 *   2. 其他组件通过 isPickerActive() 检查状态
 *   3. 如果处于活动状态，组件跳过自己的 ESC 处理
 *   4. 选择器面板关闭时调用 setPickerActive(false)
 */

let _isPickerActive = false;

/**
 * 标记选择器面板是否处于活动状态(正在消费 ESC 键)。
 * 由 ChatInput/useKeyboardInput 在显示面板时调用。
 */
export function setPickerActive(active: boolean): void {
  _isPickerActive = active;
}

/**
 * 检查选择器面板是否处于活动状态。
 * 由 ChatScreen 在处理 ESC 前调用。
 */
export function isPickerActive(): boolean {
  return _isPickerActive;
}
