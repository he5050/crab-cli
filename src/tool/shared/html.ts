/**
 * 转义 HTML 特殊字符（&、<、>、"、'）为实体编码
 * @param value - 原始字符串
 * @returns 转义后的安全字符串
 */
/** escapeHtml 的实现 */
export function escapeHtml(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * 去除 HTML 标签并解码常见 HTML 实体
 * @param html - 包含 HTML 标签的字符串
 * @returns 纯文本内容
 */
/** stripHtmlTags 的实现 */
export function stripHtmlTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

/**
 * 统计 search 在 text 中非重叠出现的次数
 * @param text - 被搜索的文本
 * @param search - 搜索子串
 * @returns 出现次数
 */
/** countMatches 的实现 */
export function countMatches(text: string, search: string): number {
  if (search.length === 0) return 0;
  let count = 0;
  let idx = 0;
  while ((idx = text.indexOf(search, idx)) !== -1) {
    count++;
    idx += search.length;
  }
  return count;
}
