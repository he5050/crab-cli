/**
 * MarkdownRenderer 工具模块
 *
 * 职责:
 *   - 提供 Markdown 渲染相关的工具函数
 *   - 主要功能:LaTeX 公式转换、文本处理、内容清理
 *
 * 模块功能:
 *   - simpleLatexToUnicode: 将 LaTeX 数学符号转换为 Unicode(40+ 符号)
 *   - processLatexInText: 处理文本中的 LaTeX 公式($$...$$ 和 $...$)
 *   - isEmptyLine: 判断行是否为空(忽略 ANSI 码)
 *   - trimLines: 裁剪首尾空行，合并连续空行
 *   - sanitizeMarkdownContent: 清理 Markdown 内容中的问题
 *
 * 使用场景:
 *   - 需要渲染包含 LaTeX 公式的 Markdown 时
 *   - 需要清理和格式化 Markdown 内容时
 *   - 需要处理终端输出的文本格式时
 *
 * 边界:
 *   1. 注意:crab-cli 主要使用 OpenTUI 原生 <markdown> 组件渲染
 *   2. 本模块仅提供辅助工具函数，不直接渲染 Markdown
 *   3. LaTeX 转换支持 40+ 常用数学符号
 *   4. 支持块级公式 $$...$$ 和行内公式 $...$
 *
 * 流程:
 *   1. 接收包含 LaTeX 的文本
 *   2. 匹配并转换 LaTeX 命令为 Unicode 符号
 *   3. 处理分数、上下标等特殊格式
 *   4. 返回转换后的纯文本
 */

// ─── LaTeX → Unicode 符号映射 ─────────────────────────────

const LATEX_SYMBOLS: Record<string, string> = {
  "\\Big": "",
  "\\Delta": "Δ",
  "\\Gamma": "Γ",
  "\\Lambda": "Λ",
  "\\Leftarrow": "⇐",
  "\\Omega": "Ω",
  "\\Phi": "Φ",
  "\\Pi": "Π",
  "\\Psi": "Ψ",
  "\\Rightarrow": "⇒",
  "\\Sigma": "Σ",
  "\\Theta": "Θ",
  "\\Xi": "Ξ",
  "\\alpha": "α",
  "\\approx": "≈",
  "\\beta": "β",
  "\\big": "",
  "\\cap": "∩",
  "\\cdot": "·",
  "\\cdots": "⋯",
  "\\chi": "χ",
  "\\cup": "∪",
  "\\delta": "δ",
  "\\div": "÷",
  "\\emptyset": "∅",
  "\\epsilon": "ε",
  "\\equiv": "≡",
  "\\eta": "η",
  "\\exists": "∃",
  "\\forall": "∀",
  "\\gamma": "γ",
  "\\geq": "≥",
  "\\in": "∈",
  "\\infty": "∞",
  "\\int": "∫",
  "\\iota": "ι",
  "\\kappa": "κ",
  "\\lambda": "λ",
  "\\langle": "⟨",
  "\\ldots": "...",
  "\\left": "",
  "\\leftarrow": "←",
  "\\leftrightarrow": "↔",
  "\\leq": "≤",
  "\\mathbf": "",
  "\\mathit": "",
  "\\mathrm": "",
  "\\mp": "∓",
  "\\mu": "μ",
  "\\nabla": "∇",
  "\\neq": "≠",
  "\\notin": "∉",
  "\\nu": "ν",
  "\\omega": "ω",
  "\\partial": "∂",
  "\\phi": "φ",
  "\\pi": "π",
  "\\pm": "±",
  "\\prod": "∏",
  "\\propto": "∝",
  "\\psi": "ψ",
  "\\rangle": "⟩",
  "\\rho": "ρ",
  "\\right": "",
  "\\rightarrow": "→",
  "\\sigma": "σ",
  "\\sim": "∼",
  "\\sqrt": "√",
  "\\subset": "⊂",
  "\\subseteq": "⊆",
  "\\sum": "∑",
  "\\supset": "⊃",
  "\\supseteq": "⊇",
  "\\tau": "τ",
  "\\text": "",
  "\\theta": "θ",
  "\\times": "×",
  "\\upsilon": "υ",
  "\\xi": "ξ",
  "\\zeta": "ζ",
};

/**
 * 简易 LaTeX → Unicode 转换。
 * 处理常见数学符号、分数、上下标。
 */
export function simpleLatexToUnicode(latex: string): string {
  let result = latex;
  // 替换已知符号
  for (const [cmd, sym] of Object.entries(LATEX_SYMBOLS)) {
    result = result.replaceAll(cmd, sym);
  }
  // 替换 \frac{a}{b} → a/b
  result = result.replace(/\\frac\{([^}]*)}\{([^}]*)}/g, "$1/$2");
  // 替换 ^{n} → ⁿ
  result = result.replace(/\^{([^}]*)}/g, "^$1");
  // 替换 _{n} → ₙ
  result = result.replace(/_{([^}]*)}/g, "_$1");
  // 清理剩余反斜杠命令
  result = result.replace(/\\[a-zA-Z]+/g, "");
  // 清理花括号
  result = result.replace(/[{}]/g, "");
  return result.trim();
}

/**
 * 处理文本中的 LaTeX 公式。
 * 将 $$...$$ 块级和 $...$ 行内公式转换为 Unicode。
 */
export function processLatexInText(text: string): string {
  // 块级公式 $$...$$
  let result = text.replace(
    /\$\$([\s\S]+?)\$\$/g,
    (_match, formula: string) => `\n${simpleLatexToUnicode(formula.trim())}\n`,
  );
  // 行内公式 $...$
  result = result.replace(/\$([^\n$]+?)\$/g, (_match, formula: string) => simpleLatexToUnicode(formula.trim()));
  return result;
}

// ─── 文本处理工具 ──────────────────────────────────────────

const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;

/** 判断是否为空行(忽略 ANSI 码) */
export function isEmptyLine(line: string): boolean {
  return line.replace(ANSI_PATTERN, "").trim() === "";
}

/** 裁剪首尾空行，合并连续空行 */
export function trimLines(lines: string[]): string[] {
  const result: string[] = [];
  let lastWasEmpty = true;

  for (const line of lines) {
    const empty = isEmptyLine(line);
    if (empty && lastWasEmpty) {
      continue;
    }
    result.push(line);
    lastWasEmpty = empty;
  }

  while (result.length > 0 && isEmptyLine(result[result.length - 1]!)) {
    result.pop();
  }

  return result;
}

/**
 * 清理 Markdown 内容中的问题。
 */
export function sanitizeMarkdownContent(content: string): string {
  return content.replace(/<ol\s+start=["']?(0|-\d+)["']?>/gi, '<ol start="1">');
}
