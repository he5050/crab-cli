/**
 * HTML 转 Markdown 转换器模块
 *
 * 职责:
 *   - 将 HTML 内容转换为 Markdown 格式
 *   - 支持常见的 HTML 标签转换
 *   - 处理表格、代码块等特殊元素
 *
 * 模块功能:
 *   - htmlToMarkdown: 主转换函数
 *   - convertTable: HTML 表格转 Markdown 表格
 *   - 支持标题、列表、链接、图片等转换
 *
 * 使用场景:
 *   - 网页内容抓取后的格式转换
 *   - 文档迁移和整理
 *   - 离线文档生成
 *
 * 边界:
 *   1. 支持标准 HTML 标签
 *   2. 复杂嵌套结构可能转换不完美
 *   3. 样式信息会丢失
 *   4. 脚本和样式标签会被移除
 *   5. 支持 aggregate 和 pages 两种模式
 *
 * 流程:
 *   1. 移除 script 和 style 标签
 *   2. 转换标题标签为 Markdown 标题
 *   3. 转换格式标签(粗体、斜体、代码)
 *   4. 转换链接和图片
 *   5. 转换列表和表格
 *   6. 清理多余空白
 */

interface ConversionOptions {
  mode?: "aggregate" | "pages";
}

/**
 * 简单的 HTML 到 Markdown 转换
 */
export async function htmlToMarkdown(html: string, _options: ConversionOptions = {}): Promise<string> {
  // 移除 script 和 style 标签
  let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "").replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");

  // 转换常见 HTML 标签为 Markdown
  text = text
    // 标题
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "# $1\n\n")
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "## $1\n\n")
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "### $1\n\n")
    .replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, "#### $1\n\n")
    .replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, "##### $1\n\n")
    .replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, "###### $1\n\n")
    // 粗体和斜体
    .replace(/<(strong|b)[^>]*>([\s\S]*?)<\/(strong|b)>/gi, "**$2**")
    .replace(/<(em|i)[^>]*>([\s\S]*?)<\/(em|i)>/gi, "*$2*")
    // 代码
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "`$1`")
    .replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, "```\n$1\n```\n")
    // 链接
    .replace(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)")
    // 图片
    .replace(/<img[^>]+src=["']([^"']+)["'][^>]*alt=["']([^"']*)["'][^>]*>/gi, "![$2]($1)")
    .replace(/<img[^>]+alt=["']([^"']*)["'][^>]*src=["']([^"']+)["'][^>]*>/gi, "![$1]($2)")
    .replace(/<img[^>]+src=["']([^"']+)["'][^>]*>/gi, "![]($1)")
    // 列表
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "- $1\n")
    .replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, "$1\n")
    .replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, "$1\n")
    // 段落和换行
    .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, "$1\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    // 表格
    .replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (match) => convertTable(match))
    // 块引用
    .replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, "> $1\n\n")
    // 水平线
    .replace(/<hr\s*\/?>/gi, "---\n\n")
    // 移除其他标签
    .replace(/<[^>]+>/g, "")
    // 解码 HTML 实体
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");

  // 清理多余空白
  text = text.replace(/\n{3,}/g, "\n\n").replace(/^[\s\n]+|[\s\n]+$/g, "");

  return text;
}

/**
 * 转换 HTML 表格为 Markdown
 */
function convertTable(html: string): string {
  // 简单提取表格内容
  const rows: string[][] = [];

  // 提取行
  const rowMatches = html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi);
  for (const rowMatch of rowMatches) {
    const cells: string[] = [];
    // 提取单元格 (th 或 td)
    const cellMatches = (rowMatch[1] ?? "").matchAll(/<(td|th)[^>]*>([\s\S]*?)<\/(td|th)>/gi);
    for (const cellMatch of cellMatches) {
      const cell = (cellMatch[2] ?? "")
        .replace(/<[^>]+>/g, "")
        .replace(/\s+/g, " ")
        .trim();
      cells.push(cell);
    }
    if (cells.length > 0) {
      rows.push(cells);
    }
  }

  if (rows.length === 0) {
    return "";
  }

  // 构建 Markdown 表格
  const maxCols = Math.max(...rows.map((r) => r.length));
  const lines: string[] = [];

  // 表头
  const header = (rows[0] ?? []).concat(Array(maxCols - (rows[0]?.length ?? 0)).fill(""));
  lines.push(`| ${header.join(" | ")} |`);

  // 分隔符
  lines.push(`| ${header.map(() => "---").join(" | ")} |`);

  // 数据行
  for (let i = 1; i < rows.length; i++) {
    const row = (rows[i] ?? []).concat(Array(maxCols - (rows[i]?.length ?? 0)).fill(""));
    lines.push(`| ${row.join(" | ")} |`);
  }

  return `${lines.join("\n")}\n\n`;
}
