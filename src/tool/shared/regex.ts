/**
 * 正则表达式工具函数
 *
 * 提供正则相关公共工具，避免各子模块重复定义。
 */

/**
 * 转义字符串中的正则特殊字符，使其可作为字面量匹配。
 * 将 `.*+?^${}()|[]\\` 等特殊字符前添加 `\` 前缀，防止用户输入被当作正则语法解析（ReDoS 防护）。
 * @param value - 需要转义的字符串
 * @returns 转义后的安全字符串
 * @example escapeRegex("file.txt")  // "file\\.txt"
 */
/** escapeRegex 的实现 */
export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}
