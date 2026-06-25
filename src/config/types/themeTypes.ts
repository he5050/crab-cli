/** 主题模式 */
export type ThemeMode = "dark" | "light";

/** 基础主题颜色(向后兼容) */
export interface ThemeColors {
  primary: string;
  secondary: string;
  accent: string;
  error: string;
  warning: string;
  success: string;
  info: string;
  muted: string;
  text: string;
  background: string;
  border: string;
}

/** Diff 颜色组 */
export interface DiffColors {
  added: string;
  removed: string;
  context: string;
  hunkHeader: string;
  highlightAdded: string;
  highlightRemoved: string;
  addedBg: string;
  removedBg: string;
  contextBg: string;
  lineNumber: string;
  addedLineNumberBg: string;
  removedLineNumberBg: string;
}

/** Markdown 颜色组 */
export interface MarkdownColors {
  text: string;
  heading: string;
  link: string;
  linkText: string;
  code: string;
  blockQuote: string;
  emph: string;
  strong: string;
  horizontalRule: string;
  listItem: string;
  listEnumeration: string;
  image: string;
  imageText: string;
  codeBlock: string;
}

/** 语法高亮颜色组 */
export interface SyntaxColors {
  comment: string;
  keyword: string;
  func: string;
  variable: string;
  string: string;
  number: string;
  type: string;
  operator: string;
  punctuation: string;
}

/** 背景扩展色组 */
export interface BackgroundColors {
  main: string;
  panel: string;
  element: string;
}

/** 边框扩展色组 */
export interface BorderColors {
  main: string;
  subtle: string;
  active: string;
}

/** 完整主题颜色(基础 + 扩展) */
export interface ExtendedThemeColors extends ThemeColors {
  textMuted: string;
  backgroundMenu: string;
  selectedListItemText: string;
  thinkingOpacity: number;
  bg: BackgroundColors;
  borderExt: BorderColors;
  diff: DiffColors;
  markdown: MarkdownColors;
  syntax: SyntaxColors;
}

/** 精确扩展 token 覆盖*/
export interface ThemeExtendedOverrides {
  textMuted?: string;
  backgroundMenu?: string;
  selectedListItemText?: string;
  thinkingOpacity?: number;
  bg?: Partial<BackgroundColors>;
  borderExt?: Partial<BorderColors>;
  diff?: Partial<DiffColors>;
  markdown?: Partial<MarkdownColors>;
  syntax?: Partial<SyntaxColors>;
}

export interface ThemeDefinition {
  name: string;
  label: string;
  mode: "dark" | "light";
  palette: string[];
  colors: ThemeColors;
  lightColors?: ThemeColors;
  extendedColors?: ThemeExtendedOverrides;
  lightExtendedColors?: ThemeExtendedOverrides;
}
