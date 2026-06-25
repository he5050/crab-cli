/**
 * 语法高亮样式生成器 — 从主题色生成 SyntaxStyle。
 *
 * 职责:
 *   - 从 ThemeColors 生成 9 种语法元素样式
 *   - 从 ExtendedThemeColors 生成增强版语法样式
 *   - 提供柔和版语法样式(用于 reasoning)
 *
 * 模块功能:
 *   - generateSyntax: 从 ExtendedThemeColors 生成完整语法高亮样式
 *   - generateSubtleSyntax: 柔和版语法高亮(用于 thinking/reasoning)
 *   - generateToolSyntaxStyle: 从基础 ThemeColors 生成工具用语法样式
 *
 * 使用场景:
 *   - 消息正文 markdown/code 渲染
 *   - 工具 diff 渲染
 *   - thinking 内容渲染
 *
 * 边界:
 *   1. 仅生成 SyntaxStyle 对象，不涉及渲染逻辑
 *   2. 依赖 @opentui/core 的 SyntaxStyle 和 RGBA
 *   3. 支持的语法元素: comment, keyword, function, variable, string, number, type, operator, punctuation
 */
import { RGBA as CoreRGBA, SyntaxStyle as CoreSyntaxStyle } from "@opentui/core";
import type { ExtendedThemeColors, ThemeColors } from "@/ui/contexts/theme";

/** 语法元素名称列表 */
export const SYNTAX_ELEMENT_NAMES = [
  "comment",
  "keyword",
  "function",
  "variable",
  "string",
  "number",
  "type",
  "operator",
  "punctuation",
] as const;

/**
 * 从 ExtendedThemeColors 生成完整语法高亮样式(9 种语法元素 + markdown markup)。
 *
 * 对齐 OpenCode 的 getSyntaxRules()，使用扩展主题色中的 syntax token。
 */
export function generateSyntax(extended: ExtendedThemeColors): CoreSyntaxStyle {
  return CoreSyntaxStyle.fromStyles({
    comment: { fg: CoreRGBA.fromHex(extended.syntax.comment) },
    default: { fg: CoreRGBA.fromHex(extended.text) },
    function: { fg: CoreRGBA.fromHex(extended.syntax.func) },
    keyword: { fg: CoreRGBA.fromHex(extended.syntax.keyword) },
    "markup.bold": { bold: true },
    "markup.heading.1": { bold: true, fg: CoreRGBA.fromHex(extended.markdown.heading) },
    "markup.heading.2": { bold: true, fg: CoreRGBA.fromHex(extended.markdown.heading) },
    "markup.heading.3": { bold: true, fg: CoreRGBA.fromHex(extended.markdown.heading) },
    "markup.italic": { italic: true },
    "markup.list": { fg: CoreRGBA.fromHex(extended.markdown.listItem) },
    "markup.raw": { fg: CoreRGBA.fromHex(extended.markdown.code) },
    number: { fg: CoreRGBA.fromHex(extended.syntax.number) },
    operator: { fg: CoreRGBA.fromHex(extended.syntax.operator) },
    punctuation: { fg: CoreRGBA.fromHex(extended.syntax.punctuation) },
    string: { fg: CoreRGBA.fromHex(extended.syntax.string) },
    type: { fg: CoreRGBA.fromHex(extended.syntax.type) },
    variable: { fg: CoreRGBA.fromHex(extended.syntax.variable) },
  });
}

/**
 * 从 ExtendedThemeColors 生成柔和版语法高亮样式。
 *
 * 用于 thinking/reasoning 内容，使用 dim 属性降低视觉强度。
 */
export function generateSubtleSyntax(extended: ExtendedThemeColors): CoreSyntaxStyle {
  return CoreSyntaxStyle.fromStyles({
    comment: { dim: true, fg: CoreRGBA.fromHex(extended.syntax.comment) },
    default: { dim: true, fg: CoreRGBA.fromHex(extended.textMuted) },
    function: { fg: CoreRGBA.fromHex(extended.syntax.func) },
    keyword: { fg: CoreRGBA.fromHex(extended.syntax.keyword) },
    "markup.bold": { bold: true },
    "markup.heading.1": { bold: true, fg: CoreRGBA.fromHex(extended.markdown.heading) },
    "markup.heading.2": { bold: true, fg: CoreRGBA.fromHex(extended.markdown.heading) },
    "markup.heading.3": { bold: true, fg: CoreRGBA.fromHex(extended.markdown.heading) },
    "markup.italic": { italic: true },
    "markup.list": { fg: CoreRGBA.fromHex(extended.markdown.listItem) },
    "markup.raw": { fg: CoreRGBA.fromHex(extended.markdown.code) },
    number: { fg: CoreRGBA.fromHex(extended.syntax.number) },
    operator: { fg: CoreRGBA.fromHex(extended.syntax.operator) },
    punctuation: { dim: true, fg: CoreRGBA.fromHex(extended.syntax.punctuation) },
    string: { fg: CoreRGBA.fromHex(extended.syntax.string) },
    type: { fg: CoreRGBA.fromHex(extended.syntax.type) },
    variable: { fg: CoreRGBA.fromHex(extended.syntax.variable) },
  });
}

/**
 * 从基础 ThemeColors 生成工具用语法高亮样式。
 *
 * 当无法获取 ExtendedThemeColors 时使用此降级版本。
 */
export function generateToolSyntaxStyle(colors: ThemeColors): CoreSyntaxStyle {
  return CoreSyntaxStyle.fromStyles({
    comment: { fg: CoreRGBA.fromHex(colors.muted) },
    default: { fg: CoreRGBA.fromHex(colors.text) },
    function: { fg: CoreRGBA.fromHex(colors.primary) },
    keyword: { fg: CoreRGBA.fromHex(colors.secondary) },
    "markup.bold": { bold: true },
    "markup.heading.1": { bold: true, fg: CoreRGBA.fromHex(colors.info) },
    "markup.heading.2": { bold: true, fg: CoreRGBA.fromHex(colors.info) },
    "markup.heading.3": { bold: true, fg: CoreRGBA.fromHex(colors.secondary) },
    "markup.italic": { italic: true },
    "markup.list": { fg: CoreRGBA.fromHex(colors.primary) },
    "markup.raw": { fg: CoreRGBA.fromHex(colors.accent) },
    number: { fg: CoreRGBA.fromHex(colors.warning) },
    operator: { fg: CoreRGBA.fromHex(colors.accent) },
    punctuation: { fg: CoreRGBA.fromHex(colors.text) },
    string: { fg: CoreRGBA.fromHex(colors.success) },
    type: { fg: CoreRGBA.fromHex(colors.info) },
    variable: { fg: CoreRGBA.fromHex(colors.text) },
  });
}
