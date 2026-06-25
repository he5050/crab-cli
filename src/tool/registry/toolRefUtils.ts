/**
 * 工具名称规范化工具函数
 *
 * 统一工具名称的标准化处理逻辑，消除 toolRegistry 和 externalToolResolver 中的重复实现。
 */

/**
 * 规范化工具名称引用: 去首尾空白、转小写、将分隔符(:/-/空格)统一为下划线、合并连续下划线。
 */
/** normalizeToolRef 的实现 */
export function normalizeToolRef(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[:\-\s]+/g, "_")
    .replace(/_+/g, "_");
}
