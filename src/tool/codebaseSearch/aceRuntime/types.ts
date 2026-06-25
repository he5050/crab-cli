/**
 * ACE Code Search 类型定义。
 *
 */

/** 代码符号类型 */
export type SymbolType =
  | "function"
  | "class"
  | "method"
  | "variable"
  | "constant"
  | "interface"
  | "type"
  | "enum"
  | "import"
  | "export";

/** 代码符号信息 */
export interface CodeSymbol {
  name: string;
  type: SymbolType;
  filePath: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  signature?: string;
  scope?: string;
  language: string;
  context?: string;
}

/** 代码引用类型 */
export type ReferenceType = "definition" | "usage" | "import" | "type";

/** 代码引用信息 */
export interface CodeReference {
  symbol: string;
  filePath: string;
  line: number;
  column: number;
  context: string;
  referenceType: ReferenceType;
}

/** 语义搜索结果 */
export interface SemanticSearchResult {
  query: string;
  symbols: CodeSymbol[];
  references: CodeReference[];
  totalResults: number;
  searchTime: number;
}

/** 文本搜索结果 */
export interface TextSearchResult {
  filePath: string;
  line: number;
  column: number;
  content: string;
}

/** 语言配置 */
export interface LanguageConfig {
  extensions: string[];
  parser: string;
  symbolPatterns: {
    function: RegExp;
    class: RegExp;
    variable?: RegExp;
    import?: RegExp;
    export?: RegExp;
  };
}

/** 索引统计 */
export interface IndexStats {
  totalFiles: number;
  totalSymbols: number;
  languageBreakdown: Record<string, number>;
  cacheAge: number;
}
