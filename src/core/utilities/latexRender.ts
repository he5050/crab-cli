/**
 * LaTeX 渲染 — 将 LaTeX 数学公式转换为终端友好的 Unicode 文本。
 *
 * 职责:
 *   - 解析 LaTeX 数学语法
 *   - 替换为 Unicode 数学符号
 *   - 支持上标、下标、分数等常见格式
 *
 * 模块功能:
 *   - latexToUnicode: 将 LaTeX 转换为 Unicode 文本
 *   - renderLatexInText: 从 Markdown 中提取并渲染 LaTeX
 *   - toSuperscript: 数字转上标
 *   - toSubscript: 数字转下标
 *
 * 使用场景:
 *   - 终端显示数学公式
 *   - Markdown 文本中的 LaTeX 渲染
 *   - 无需外部依赖的轻量级渲染
 *
 * 边界:
 *   1. 仅处理常见 LaTeX 命令(80+ 个)
 *   2. 不依赖外部库(无 katex 依赖)
 *   3. 复杂公式可能渲染不完整
 *
 * 流程:
 *   1. 解析 LaTeX 输入
 *   2. 替换命令为 Unicode 符号
 *   3. 处理上标、下标、分数
 *   4. 清理分隔符和多余字符
 *   5. 返回渲染后的文本
 */

/** LaTeX 命令到 Unicode 符号映射表 */
const LATEX_TO_UNICODE: Record<string, string> = {
  // 希腊字母(小写)
  "\\alpha": "α",
  "\\beta": "β",
  "\\gamma": "γ",
  "\\delta": "δ",
  "\\epsilon": "ε",
  "\\varepsilon": "ε",
  "\\zeta": "ζ",
  "\\eta": "η",
  "\\theta": "θ",
  "\\iota": "ι",
  "\\kappa": "κ",
  "\\lambda": "λ",
  "\\mu": "μ",
  "\\nu": "ν",
  "\\xi": "ξ",
  "\\pi": "π",
  "\\rho": "ρ",
  "\\sigma": "σ",
  "\\tau": "τ",
  "\\upsilon": "υ",
  "\\phi": "φ",
  "\\chi": "χ",
  "\\psi": "ψ",
  "\\omega": "ω",

  // 希腊字母(大写)
  "\\Gamma": "Γ",
  "\\Delta": "Δ",
  "\\Theta": "Θ",
  "\\Lambda": "Λ",
  "\\Xi": "Ξ",
  "\\Pi": "Π",
  "\\Sigma": "Σ",
  "\\Upsilon": "Υ",
  "\\Phi": "Φ",
  "\\Psi": "Ψ",
  "\\Omega": "Ω",

  // 数学运算符
  "\\pm": "±",
  "\\mp": "∓",
  "\\times": "×",
  "\\div": "÷",
  "\\cdot": "⋅",
  "\\ast": "∗",
  "\\star": "⋆",
  "\\circ": "∘",
  "\\bullet": "•",
  "\\oplus": "⊕",
  "\\otimes": "⊗",
  "\\odot": "⊙",

  // 关系符号
  "\\leq": "≤",
  "\\geq": "≥",
  "\\neq": "≠",
  "\\approx": "≈",
  "\\equiv": "≡",
  "\\sim": "∼",
  "\\simeq": "≃",
  "\\cong": "≅",
  "\\propto": "∝",
  "\\ll": "≪",
  "\\gg": "≫",

  // 集合符号
  "\\in": "∈",
  "\\notin": "∉",
  "\\subset": "⊂",
  "\\supset": "⊃",
  "\\subseteq": "⊆",
  "\\supseteq": "⊇",
  "\\cup": "∪",
  "\\cap": "∩",
  "\\emptyset": "∅",
  "\\varnothing": "∅",

  // 逻辑符号
  "\\land": "∧",
  "\\lor": "∨",
  "\\neg": "¬",
  "\\forall": "∀",
  "\\exists": "∃",

  // 箭头
  "\\rightarrow": "→",
  "\\leftarrow": "←",
  "\\leftrightarrow": "↔",
  "\\Rightarrow": "⇒",
  "\\Leftarrow": "⇐",
  "\\Leftrightarrow": "⇔",
  "\\uparrow": "↑",
  "\\downarrow": "↓",

  // 积分、求和、乘积
  "\\int": "∫",
  "\\iint": "∬",
  "\\iiint": "∭",
  "\\oint": "∮",
  "\\sum": "∑",
  "\\prod": "∏",
  "\\coprod": "∐",

  // 其他
  "\\infty": "∞",
  "\\nabla": "∇",
  "\\partial": "∂",
  "\\sqrt": "√",
  "\\angle": "∠",
  "\\perp": "⊥",
  "\\parallel": "∥",
  "\\hbar": "ℏ",
  "\\ell": "ℓ",
  "\\Re": "ℜ",
  "\\Im": "ℑ",
  "\\aleph": "ℵ",
  "\\wp": "℘",
};

/** 上标数字映射 */
const SUPERSCRIPTS = "⁰¹²³⁴⁵⁶⁷⁸⁹";
/** 下标数字映射 */
const SUBSCRIPTS = "₀₁₂₃₄₅₆₇₈₉";

/**
 * 将数字转换为上标字符串。
 */
function toSuperscript(num: string): string {
  return [...num].map((d) => SUPERSCRIPTS[parseInt(d, 10)] ?? d).join("");
}

/**
 * 将数字转换为下标字符串。
 */
function toSubscript(num: string): string {
  return [...num].map((d) => SUBSCRIPTS[parseInt(d, 10)] ?? d).join("");
}

/**
 * 将 LaTeX 数学公式转换为 Unicode 文本。
 *
 * 支持:
 *   - 希腊字母、运算符、关系符号等 80+ LaTeX 命令
 *   - 上标 ^{}  和下标 _{}
 *   - \frac{a}{b} → a/b
 *   - \text{...} → 原样输出
 *   - 行内 $...$ 和块级 $$...$$ 分隔符清理
 *
 * @param latex LaTeX 公式字符串
 * @param displayMode 是否为块级公式(添加换行)
 */
export function latexToUnicode(latex: string, displayMode = false): string {
  let result = latex;

  // 1. 替换 \frac{a}{b} → a/b
  result = result.replace(/\\frac\{([^}]*)}\{([^}]*)}/g, (_, a, b) => `${a}/${b}`);

  // 2. 替换 \text{...} → 内容
  result = result.replace(/\\text\{([^}]*)}/g, "$1");
  result = result.replace(/\\mathrm\{([^}]*)}/g, "$1");
  result = result.replace(/\\textbf\{([^}]*)}/g, "$1");

  // 3. 替换 LaTeX 命令为 Unicode 符号(按长度降序，避免短命令吞掉长命令的前缀)
  const sortedEntries = Object.entries(LATEX_TO_UNICODE).toSorted((a, b) => b[0].length - a[0].length);
  for (const [cmd, unicode] of sortedEntries) {
    const escaped = cmd.replace(/\\/g, String.raw`\\`);
    result = result.replace(new RegExp(escaped, "g"), unicode);
  }

  // 4. 处理上标 ^{...} 和 ^x
  result = result.replace(/\^{([^}]*)}/g, (_, content) => toSuperscript(content));
  result = result.replace(/\^(\d)/g, (_, d) => toSuperscript(d));

  // 5. 处理下标 _{...} 和 _x
  result = result.replace(/_{([^}]*)}/g, (_, content) => toSubscript(content));
  result = result.replace(/_(\d)/g, (_, d) => toSubscript(d));

  // 6. 清理剩余花括号
  result = result.replace(/[{}]/g, "");

  // 7. 清理行内 $ 分隔符
  result = result.replace(/\$/g, "");

  // 8. 清理多余空白
  result = result.replace(/\s+/g, " ").trim();

  if (displayMode) {
    result = `\n  ${result}\n`;
  }

  return result || latex;
}

/**
 * 从 Markdown 文本中提取并渲染 LaTeX 公式。
 *
 * 支持 $...$ (行内) 和 $$...$$ (块级) 格式。
 *
 * @param text 包含 LaTeX 公式的文本
 * @returns 渲染后的文本
 */
export function renderLatexInText(text: string): string {
  // 块级公式 $$...$$
  let result = text.replace(/\$\$([^$]+)\$\$/g, (_, latex) => latexToUnicode(latex, true));

  // 行内公式 $...$
  result = result.replace(/\$([^$]+)\$/g, (_, latex) => latexToUnicode(latex, false));

  return result;
}
