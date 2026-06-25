/**
 * 代码结构分析 — 括号平衡、HTML 标签平衡、缩进一致性。
 *
 * 职责:
 *   - 分析代码结构完整性
 *   - 检查括号平衡
 *   - 检查 HTML 标签平衡
 *   - 检查缩进一致性
 *   - 智能扩展上下文边界
 *
 * 模块功能:
 *   - analyzeCodeStructure: 分析代码结构
 *   - findSmartContextBoundaries: 查找智能上下文边界
 *   - 括号平衡统计
 *   - HTML 标签平衡检查
 *   - 缩进警告生成
 *
 * 使用场景:
 *   - 编辑后代码验证
 *   - 结构完整性检查
 *   - 自动补全上下文
 *   - 代码质量分析
 *
 * 边界:
 *   1. 检查花括号、圆括号、方括号平衡
 *   2. 检查 HTML 标签开闭匹配
 *   3. 检测缩进不一致
 *   4. 移除字符串和注释后分析
 *   5. 智能扩展至完整代码块
 *
 * 流程:
 *   1. 清理字符串和注释
 *   2. 统计括号开闭数量
 *   3. 检查 HTML 标签平衡
 *   4. 检测缩进问题
 *   5. 返回结构分析结果
 */

/** 括号平衡统计 */
export interface BracketBalance {
  open: number;
  close: number;
  balanced: boolean;
}

/** HTML 标签平衡统计 */
export interface HtmlTagBalance {
  unclosedTags: string[];
  unopenedTags: string[];
  balanced: boolean;
}

/** 代码结构分析结果 */
export interface StructureAnalysis {
  bracketBalance: {
    curly: BracketBalance;
    round: BracketBalance;
    square: BracketBalance;
  };
  htmlTags?: HtmlTagBalance;
  indentationWarnings: string[];
}

/**
 * 分析代码结构，检测括号不匹配、未闭合标签、缩进不一致等问题。
 * @param _content 原始文件内容(未使用，保留兼容)
 * @param filePath 文件路径(用于判断是否为标记文件)
 * @param editedLines 被编辑的行内容
 * @returns 代码结构分析结果
 */
/** analyzeCodeStructure 的实现 */
export function analyzeCodeStructure(_content: string, filePath: string, editedLines: string[]): StructureAnalysis {
  const analysis: StructureAnalysis = {
    bracketBalance: {
      curly: { balanced: true, close: 0, open: 0 },
      round: { balanced: true, close: 0, open: 0 },
      square: { balanced: true, close: 0, open: 0 },
    },
    indentationWarnings: [],
  };

  const editedContent = editedLines.join("\n");

  // 移除字符串字面量和注释，避免误报
  const cleanContent = editedContent
    .replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g, '""')
    .replace(/\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");

  // 统计括号
  analysis.bracketBalance.curly.open = (cleanContent.match(/\{/g) || []).length;
  analysis.bracketBalance.curly.close = (cleanContent.match(/\}/g) || []).length;
  analysis.bracketBalance.curly.balanced = analysis.bracketBalance.curly.open === analysis.bracketBalance.curly.close;

  analysis.bracketBalance.round.open = (cleanContent.match(/\(/g) || []).length;
  analysis.bracketBalance.round.close = (cleanContent.match(/\)/g) || []).length;
  analysis.bracketBalance.round.balanced = analysis.bracketBalance.round.open === analysis.bracketBalance.round.close;

  analysis.bracketBalance.square.open = (cleanContent.match(/\[/g) || []).length;
  analysis.bracketBalance.square.close = (cleanContent.match(/\]/g) || []).length;
  analysis.bracketBalance.square.balanced =
    analysis.bracketBalance.square.open === analysis.bracketBalance.square.close;

  // HTML/JSX 标签分析(仅对标记文件)
  const isMarkupFile = /\.(html|jsx|tsx|vue)$/i.test(filePath);
  if (isMarkupFile) {
    const tagPattern = /<\/?([a-zA-Z][a-zA-Z0-9-]*)[^>]*>/g;
    const selfClosingPattern = /<[a-zA-Z][a-zA-Z0-9-]*[^>]*\/>/g;

    const contentWithoutSelfClosing = cleanContent.replace(selfClosingPattern, "");
    const tags: string[] = [];
    const unclosedTags: string[] = [];
    const unopenedTags: string[] = [];

    let match;
    while ((match = tagPattern.exec(contentWithoutSelfClosing)) !== null) {
      const isClosing = match[0]?.startsWith("</");
      const tagName = match[1]?.toLowerCase();
      if (!tagName) {
        continue;
      }

      if (isClosing) {
        const lastOpenTag = tags.pop();
        if (!lastOpenTag || lastOpenTag !== tagName) {
          unopenedTags.push(tagName);
          if (lastOpenTag) {
            tags.push(lastOpenTag);
          }
        }
      } else {
        tags.push(tagName);
      }
    }

    unclosedTags.push(...tags);

    analysis.htmlTags = {
      balanced: unclosedTags.length === 0 && unopenedTags.length === 0,
      unclosedTags,
      unopenedTags,
    };
  }

  // 缩进一致性检查
  const lines = editedContent.split("\n");
  const indents = lines
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const m = line.match(/^(\s*)/);
      return m ? m[1] : "";
    })
    .filter((indent): indent is string => indent !== undefined);

  const hasTabs = indents.some((indent) => indent.includes("\t"));
  const hasSpaces = indents.some((indent) => indent.includes(" "));
  if (hasTabs && hasSpaces) {
    analysis.indentationWarnings.push("Mixed tabs and spaces detected");
  }

  if (!hasTabs && hasSpaces) {
    const spaceCounts = indents.filter((indent) => indent.length > 0).map((indent) => indent.length);

    if (spaceCounts.length > 1) {
      const gcd = spaceCounts.reduce((a, b) => {
        while (b !== 0) {
          const temp = b;
          b = a % b;
          a = temp;
        }
        return a;
      });

      const hasInconsistent = spaceCounts.some((count) => count % gcd !== 0 && gcd > 1);
      if (hasInconsistent) {
        analysis.indentationWarnings.push(`Inconsistent indentation (expected multiples of ${gcd} spaces)`);
      }
    }
  }

  return analysis;
}

/**
 * 智能扩展上下文边界，将编辑范围延伸到完整的代码块边界。
 * @param lines 文件所有行
 * @param startLine 编辑起始行号(1-based)
 * @param endLine 编辑结束行号(1-based)
 * @param requestedContext 请求的上下文行数
 * @returns 扩展后的起止行号及是否发生扩展
 */
/** findSmartContextBoundaries 的实现 */
export function findSmartContextBoundaries(
  lines: string[],
  startLine: number,
  endLine: number,
  requestedContext: number,
): { start: number; end: number; extended: boolean } {
  const totalLines = lines.length;
  let contextStart = Math.max(1, startLine - requestedContext);
  let contextEnd = Math.min(totalLines, endLine + requestedContext);
  let extended = false;

  // 向上寻找块起始
  let bracketDepth = 0;
  for (let i = startLine - 1; i >= Math.max(0, startLine - 50); i--) {
    const line = lines[i];
    if (!line) {
      continue;
    }
    const trimmed = line.trim();

    const openBrackets = (line.match(/\{/g) || []).length;
    const closeBrackets = (line.match(/\}/g) || []).length;
    bracketDepth += closeBrackets - openBrackets;

    if (
      bracketDepth === 0 &&
      (trimmed.match(/^(function|class|const|let|var|if|for|while|async|export)\s/i) ||
        trimmed.match(/=>\s*\{/) ||
        trimmed.match(/^\w+\s*\(/))
    ) {
      if (i + 1 < contextStart) {
        contextStart = i + 1;
        extended = true;
      }
      break;
    }
  }

  // 向下寻找块结束
  bracketDepth = 0;
  for (let i = endLine - 1; i < Math.min(totalLines, endLine + 50); i++) {
    const line = lines[i];
    if (!line) {
      continue;
    }
    const trimmed = line.trim();

    const openBrackets = (line.match(/\{/g) || []).length;
    const closeBrackets = (line.match(/\}/g) || []).length;
    bracketDepth += openBrackets - closeBrackets;

    if (bracketDepth === 0 && trimmed.startsWith("}")) {
      if (i + 1 > contextEnd) {
        contextEnd = i + 1;
        extended = true;
      }
      break;
    }
  }

  return { end: contextEnd, extended, start: contextStart };
}
