/**
 * [语言检测模块]
 *
 * 职责:
 *   - 根据文件扩展名检测编程语言
 *   - 提供语言信息(ID、扩展名、显示名称)
 *   - 推荐文件对应的 LSP Server
 *
 * 模块功能:
 *   - 维护扩展名到语言信息的映射表
 *   - 根据文件路径检测语言
 *   - 获取文件推荐的 LSP Server
 *   - 获取所有支持的语言列表
 *
 * 使用场景:
 *   - LSP Manager 根据文件选择对应 Server
 *   - 代码编辑器显示文件类型
 *   - 语法高亮和语言特性支持
 *
 * 边界:
 *   1. 仅通过文件扩展名检测，不分析文件内容
 *   2. 不支持动态注册新语言
 *   3. 扩展名区分大小写(统一转小写处理)
 *   4. 部分语言无内置 LSP Server 支持
 *
 * 流程:
 *   1. 定义 EXTENSION_MAP 扩展名映射表
 *   2. 提供 detectLanguage 检测语言
 *   3. 提供 getLspServerForFile 获取推荐 Server
 *   4. 提供 listSupportedLanguages 列出支持语言
 */
import path from "path";

/** 语言信息 */
export interface LanguageInfo {
  /** 语言 ID(如 typescript、python) */
  languageId: string;
  /** 文件扩展名 */
  extension: string;
  /** 显示名称 */
  label: string;
  /** 推荐 LSP Server */
  lspServer?: string;
}

/** 扩展名 → 语言映射 */
const EXTENSION_MAP: Record<string, LanguageInfo> = {
  ".bash": { extension: ".bash", label: "Bash", languageId: "shellscript" },
  ".c": { extension: ".c", label: "C", languageId: "c", lspServer: "clangd" },
  ".cjs": {
    extension: ".cjs",
    label: "JavaScript (CJS)",
    languageId: "javascript",
    lspServer: "typescript-language-server",
  },
  ".cpp": { extension: ".cpp", label: "C++", languageId: "cpp", lspServer: "clangd" },
  ".cs": { extension: ".cs", label: "C#", languageId: "csharp", lspServer: "omnisharp" },
  ".css": { extension: ".css", label: "CSS", languageId: "css" },
  ".go": { extension: ".go", label: "Go", languageId: "go", lspServer: "gopls" },
  ".h": { extension: ".h", label: "C Header", languageId: "c", lspServer: "clangd" },
  ".hpp": { extension: ".hpp", label: "C++ Header", languageId: "cpp", lspServer: "clangd" },
  ".html": { extension: ".html", label: "HTML", languageId: "html" },
  ".java": { extension: ".java", label: "Java", languageId: "java" },
  ".js": { extension: ".js", label: "JavaScript", languageId: "javascript", lspServer: "typescript-language-server" },
  ".json": { extension: ".json", label: "JSON", languageId: "json" },
  ".jsx": {
    extension: ".jsx",
    label: "JavaScript JSX",
    languageId: "javascriptreact",
    lspServer: "typescript-language-server",
  },
  ".kt": { extension: ".kt", label: "Kotlin", languageId: "kotlin", lspServer: "kotlin-language-server" },
  ".lua": { extension: ".lua", label: "Lua", languageId: "lua", lspServer: "lua-language-server" },
  ".md": { extension: ".md", label: "Markdown", languageId: "markdown" },
  ".mjs": {
    extension: ".mjs",
    label: "JavaScript (ESM)",
    languageId: "javascript",
    lspServer: "typescript-language-server",
  },
  ".php": { extension: ".php", label: "PHP", languageId: "php", lspServer: "intelephense" },
  ".py": { extension: ".py", label: "Python", languageId: "python", lspServer: "pyright" },
  ".rb": { extension: ".rb", label: "Ruby", languageId: "ruby", lspServer: "solargraph" },
  ".rs": { extension: ".rs", label: "Rust", languageId: "rust", lspServer: "rust-analyzer" },
  ".scss": { extension: ".scss", label: "SCSS", languageId: "scss" },
  ".sh": { extension: ".sh", label: "Shell", languageId: "shellscript" },
  ".sql": { extension: ".sql", label: "SQL", languageId: "sql" },
  ".swift": { extension: ".swift", label: "Swift", languageId: "swift", lspServer: "sourcekit-lsp" },
  ".toml": { extension: ".toml", label: "TOML", languageId: "toml" },
  ".ts": { extension: ".ts", label: "TypeScript", languageId: "typescript", lspServer: "typescript-language-server" },
  ".tsx": {
    extension: ".tsx",
    label: "TypeScript JSX",
    languageId: "typescriptreact",
    lspServer: "typescript-language-server",
  },
  ".yaml": { extension: ".yaml", label: "YAML", languageId: "yaml" },
  ".yml": { extension: ".yml", label: "YAML", languageId: "yaml" },
  ".zig": { extension: ".zig", label: "Zig", languageId: "zig", lspServer: "zls" },
  ".zsh": { extension: ".zsh", label: "Zsh", languageId: "shellscript" },
};

/**
 * 根据文件路径检测语言。
 */
export function detectLanguage(filePath: string): LanguageInfo | null {
  const ext = path.extname(filePath).toLowerCase();
  return EXTENSION_MAP[ext] ?? null;
}

/**
 * 获取文件推荐的 LSP Server。
 */
export function getLspServerForFile(filePath: string): string | null {
  return detectLanguage(filePath)?.lspServer ?? null;
}

/**
 * 获取所有支持的语言列表。
 */
export function listSupportedLanguages(): LanguageInfo[] {
  return Object.values(EXTENSION_MAP);
}
