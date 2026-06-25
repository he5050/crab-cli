/**
 * ACE Code Search 语言配置 — 28 种编程语言的符号正则模式定义
 *
 * 职责:
 *   - 定义 28 种编程语言的符号解析正则模式
 *   - 提供文件扩展名到语言的映射
 *   - 支持无 ctags 时的正则回退解析
 *
 * 模块功能:
 *   - LANGUAGE_CONFIG: 28 种编程语言的符号解析配置(包含扩展名、解析器、正则模式)
 *   - detectLanguage: 从文件扩展名检测编程语言
 *
 * 使用场景:
 *   - ACE 代码符号解析的语料库
 *   - 多语言代码库的符号提取
 *   - IDE 中的语言识别
 *
 * 边界:
 * 1. 支持的语言包括:TypeScript、JavaScript、Python、Go、Rust、Java、C#、C、C++、PHP、Ruby、Swift、Kotlin、Dart、Shell、Scala、R、Lua、Perl、Haskell、Elixir、Clojure、F#、SQL、HTML、CSS、Vue、Svelte、YAML、JSON、TOML、Markdown
 * 2. 每种语言配置包含 function、class、variable、import、export 五种符号类型的正则
 * 3. 正则模式用于在无 ctags 时进行简单的符号提取
 *
 * 流程:
 * 1. 根据文件扩展名查找对应语言配置
 * 2. 使用语言对应的正则模式匹配符号
 * 3. 提取符号名称、类型、位置等信息
 */

import type { LanguageConfig } from "./types";

/** 语言符号解析配置，28 种编程语言的扩展名和正则模式 */
export const LANGUAGE_CONFIG: Record<string, LanguageConfig> = {
  c: {
    extensions: [".c", ".h"],
    parser: "c",
    symbolPatterns: {
      class: /(?:struct|union|enum)\s+(\w+)\s*\{/,
      export: /^[\w\s*]+\s+(\w+)\s*\([^)]*\)\s*;/,
      function: /(?:static|extern|inline)?\s*[\w\s*]+\s+(\w+)\s*\([^)]*\)\s*\{/,
      import: /#include\s+[<"]([^>"]+)[>"]/,
      variable: /(?:extern|static|const)?\s*[\w\s*]+\s+(\w+)\s*[=;]/,
    },
  },
  clojure: {
    extensions: [".clj", ".cljs", ".cljc", ".edn"],
    parser: "clojure",
    symbolPatterns: {
      class: /\(defrecord\s+(\w+)|\(deftype\s+(\w+)|\(defprotocol\s+(\w+)/,
      export: /\(defn-?\s+(\w+)/,
      function: /\(defn-?\s+(\w+)/,
      import: /\(:require\s+\[([^\]]+)\]/,
      variable: /\(def\s+(\w+)/,
    },
  },
  cpp: {
    extensions: [".cpp", ".cc", ".cxx", ".hpp", ".hh", ".hxx", ".h++", ".c++"],
    parser: "cpp",
    symbolPatterns: {
      class:
        /(?:class|struct|union|enum\s+class|enum\s+struct)\s+(\w+)(?:\s*:\s*(?:public|private|protected)\s+[\w,\s<>]+)?\s*\{/,
      export: /^[\w\s*&:<>,]+\s+(\w+)\s*\([^)]*\)\s*;/,
      function:
        /(?:static|extern|inline|virtual|explicit|constexpr)?\s*[\w\s*&:<>,]+\s+(\w+)\s*\([^)]*\)\s*(?:const)?\s*(?:override)?\s*\{/,
      import: /#include\s+[<"]([^>"]+)[>"]/,
      variable: /(?:extern|static|const|constexpr|inline)?\s*[\w\s*&:<>,]+\s+(\w+)\s*[=;]/,
    },
  },
  csharp: {
    extensions: [".cs"],
    parser: "csharp",
    symbolPatterns: {
      class:
        /(?:\[[\w\s,()]+\]\s+)*(?:public|private|protected|internal)?\s*(?:abstract|sealed|static|partial)?\s*(?:class|interface|struct|record|enum)\s+(\w+)/,
      export: /public\s+(?:class|interface|enum|struct|record|delegate)\s+(\w+)/,
      function:
        /(?:\[[\w\s,()]+\]\s+)*(?:public|private|protected|internal|static|virtual|override|abstract|async|\s)+[\w<>[\]?]+\s+(\w+)\s*[<(]/,
      import: /using\s+(?:static\s+)?([\w.]+);/,
      variable:
        /(?:\[[\w\s,()]+\]\s+)*(?:public|private|protected|internal|static|readonly|const|volatile|\s)+[\w<>[\]?]+\s+(\w+)\s*[{=;]|(?:public|private|protected|internal)?\s*[\w<>[\]?]+\s+(\w+)\s*\{\s*get/,
    },
  },
  css: {
    extensions: [".css", ".scss", ".sass", ".less", ".styl"],
    parser: "css",
    symbolPatterns: {
      class: /\.(\w+(?:-\w+)*)\s*\{/,
      export: /@mixin\s+(\w+)|@function\s+(\w+)/,
      function: /@mixin\s+(\w+)|@function\s+(\w+)/,
      import: /@import\s+(?:url\()?['"]([^'"]+)['"]/,
      variable: /--(\w+(?:-\w+)*):|@(\w+):|(\$\w+):/,
    },
  },
  dart: {
    extensions: [".dart"],
    parser: "dart",
    symbolPatterns: {
      class:
        /(?:abstract)?\s*class\s+(\w+)(?:\s+extends\s+[\w<>]+)?(?:\s+with\s+[\w,\s<>]+)?(?:\s+implements\s+[\w,\s<>]+)?\s*\{/,
      export: /^(?:class|abstract\s+class|enum|mixin)\s+(\w+)/,
      function: /(?:static|abstract|external)?\s*[\w<>?,\s]+\s+(\w+)\s*\([^)]*\)\s*(?:async|sync\*)?\s*\{/,
      import: /import\s+['"]([^'"]+)['"]/,
      variable: /(?:static|final|const|late)?\s*(?:var|[\w<>?,\s]+)\s+(\w+)\s*[=;]/,
    },
  },
  elixir: {
    extensions: [".ex", ".exs"],
    parser: "elixir",
    symbolPatterns: {
      class: /defmodule\s+([\w.]+)\s+do/,
      export: /^def\s+(\w+)/,
      function: /def(?:p|macro|macrop)?\s+(\w+)(?:\(|,|\s+do)/,
      import: /(?:import|alias|require|use)\s+([\w.]+)/,
      variable: /@(\w+)\s+|(\w+)\s*=\s*(?!fn)/,
    },
  },
  fsharp: {
    extensions: [".fs", ".fsx", ".fsi"],
    parser: "fsharp",
    symbolPatterns: {
      class: /type\s+(\w+)\s*(?:=|<|\()/,
      export: /^(?:let|type)\s+(\w+)/,
      function: /let\s+(?:rec\s+)?(\w+)(?:\s+\w+)*\s*=/,
      import: /open\s+([\w.]+)/,
      variable: /let\s+(?:mutable\s+)?(\w+)\s*=/,
    },
  },
  go: {
    extensions: [".go"],
    parser: "go",
    symbolPatterns: {
      class: /type\s+(\w+)\s+(?:struct|interface)/,
      export: /^(?:func|type|var|const)\s+([A-Z]\w+)|^type\s+([A-Z]\w+)\s+(?:struct|interface)/,
      function: /func\s+(?:\([^)]+\)\s+)?(\w+)\s*[<(]/,
      import: /import\s+(?:"([^"]+)"|_\s+"([^"]+)"|\w+\s+"([^"]+)")/,
      variable: /(?:var|const)\s+(\w+)\s+[\w[\]*{]|(?:var|const)\s+\(\s*(\w+)/,
    },
  },
  haskell: {
    extensions: [".hs", ".lhs"],
    parser: "haskell",
    symbolPatterns: {
      class: /(?:class|instance)\s+(\w+)/,
      export: /module\s+[\w.]+\s*\(([^)]+)\)/,
      function: /^(\w+)\s*::/,
      import: /import\s+(?:qualified\s+)?([\w.]+)/,
      variable: /^(\w+)\s*=/,
    },
  },
  html: {
    extensions: [".html", ".htm", ".xhtml"],
    parser: "html",
    symbolPatterns: {
      class: /class\s*=\s*["']([^"']+)["']/,
      export: /<(?:div|section|article|header|footer)[^>]+id\s*=\s*["']([^"']+)["']/,
      function: /<script[^>]*>[\s\S]*?function\s+(\w+)/,
      import: /<(?:link|script)[^>]+(?:href|src)\s*=\s*["']([^"']+)["']/,
      variable: /id\s*=\s*["']([^"']+)["']/,
    },
  },
  java: {
    extensions: [".java"],
    parser: "java",
    symbolPatterns: {
      class:
        /(?:@\w+\s+)*(?:public|private|protected)?\s*(?:abstract|final|static)?\s*(?:class|interface|enum|record|@interface)\s+(\w+)/,
      export: /public\s+(?:class|interface|enum|record|@interface)\s+(\w+)/,
      function:
        /(?:@\w+\s+)*(?:public|private|protected|static|final|synchronized|native|abstract|\s)+[\w<>[\]]+\s+(\w+)\s*\([^)]*\)\s*(?:throws\s+[\w,\s]+)?\s*[{;]/,
      import: /import\s+(?:static\s+)?([\w.*]+);/,
      variable: /(?:@\w+\s+)*(?:public|private|protected|static|final|transient|volatile|\s)+[\w<>[\]]+\s+(\w+)\s*[=;]/,
    },
  },
  javascript: {
    extensions: [".js", ".jsx", ".mjs", ".cjs", ".es", ".es6"],
    parser: "javascript",
    symbolPatterns: {
      class: /(?:export\s+)?class\s+(\w+)/,
      export: /export\s+(?:default\s+)?(?:class|function|const|let|var)\s+(\w+)/,
      function:
        /(?:export\s+)?(?:async\s+)?(?:function\s*\*?\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:function\s*\*?\s*)?(?:\([^)]*\)\s*=>|\([^)]*\)\s*\{))|(\w+)\s*\([^)]*\)\s*\{/,
      import: /import\s+(?:{[^}]+}|\w+|\*\s+as\s+\w+)\s+from\s+['"]([^'"]+)['"]/,
      variable: /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=/,
    },
  },
  json: {
    extensions: [".json", ".jsonc", ".json5"],
    parser: "json",
    symbolPatterns: {
      class: /^$/,
      export: /^$/,
      function: /^$/,
      import: /^$/,
      variable: /"(\w+)"\s*:/,
    },
  },
  kotlin: {
    extensions: [".kt", ".kts"],
    parser: "kotlin",
    symbolPatterns: {
      class:
        /(?:public|private|protected|internal)?\s*(?:abstract|open|final|sealed|data|inline|value)?\s*(?:class|interface|object|enum\s+class)\s+(\w+)/,
      export: /^(?:public\s+)?(?:fun|class|interface|object|val|var)\s+(\w+)/,
      function: /(?:public|private|protected|internal)?\s*(?:suspend|inline|infix|operator)?\s*fun\s+(\w+)\s*[<(]/,
      import: /import\s+([\w.]+)/,
      variable: /(?:public|private|protected|internal)?\s*(?:const)?\s*(?:val|var)\s+(\w+)\s*[:=]/,
    },
  },
  lua: {
    extensions: [".lua"],
    parser: "lua",
    symbolPatterns: {
      class: /(\w+)\s*=\s*\{\s*\}|(\w+)\s*=\s*class\s*\(/,
      export: /return\s+(\w+)|module\s*\(\s*['"]([^'"]+)['"]/,
      function: /(?:local\s+)?function\s+(?:[\w.]+[.:])?(\w+)\s*\(/,
      import: /require\s*\(?['"]([^'"]+)['"]\)?/,
      variable: /(?:local\s+)?(\w+)\s*=/,
    },
  },
  markdown: {
    extensions: [".md", ".markdown", ".mdown", ".mkd"],
    parser: "markdown",
    symbolPatterns: {
      class: /^#{1,6}\s+(.+)$/m,
      export: /^#{1,6}\s+(.+)$/m,
      function: /```[\w]*\n[\s\S]*?function\s+(\w+)/,
      import: /\[([^\]]+)\]\(([^)]+)\)/,
      variable: /\[([^\]]+)\]:/,
    },
  },
  perl: {
    extensions: [".pl", ".pm", ".t", ".pod"],
    parser: "perl",
    symbolPatterns: {
      class: /package\s+([\w:]+)\s*;/,
      export: /^sub\s+(\w+)|our\s+[$@%](\w+)/,
      function: /sub\s+(\w+)\s*\{/,
      import: /(?:use|require)\s+([\w:]+)/,
      variable: /(?:my|our|local)\s*[$@%](\w+)\s*=/,
    },
  },
  php: {
    extensions: [".php", ".phtml", ".php3", ".php4", ".php5", ".phps"],
    parser: "php",
    symbolPatterns: {
      class: /(?:abstract|final)?\s*class\s+(\w+)(?:\s+extends\s+\w+)?(?:\s+implements\s+[\w,\s]+)?\s*\{/,
      export: /^(?:public\s+)?(?:function|class|interface|trait)\s+(\w+)/,
      function: /(?:public|private|protected|static)?\s*function\s+(\w+)\s*\(/,
      import: /(?:require|require_once|include|include_once)\s*[('"]([^'"]+)['"]/,
      variable: /(?:public|private|protected|static)?\s*\$(\w+)\s*[=;]/,
    },
  },
  python: {
    extensions: [".py", ".pyx", ".pyi", ".pyw", ".pyz"],
    parser: "python",
    symbolPatterns: {
      class: /(?:@\w+\s+)*class\s+(\w+)\s*[(:]/,
      export: /^(?:__all__\s*=|def\s+(\w+)|class\s+(\w+))/,
      function: /(?:@\w+\s+)*(?:async\s+)?def\s+(\w+)\s*\(/,
      import: /(?:from\s+([\w.]+)\s+import\s+[\w, *]+|import\s+([\w.]+(?:\s+as\s+\w+)?))/,
      variable: /^(?:[\t ]*)([\w_][\w\d_]*)\s*(?::.*)?=\s*(?![=\s])|^([\w_][\w\d_]*)\s*:\s*(?!.*=)/m,
    },
  },
  r: {
    extensions: [".r", ".R", ".rmd", ".Rmd"],
    parser: "r",
    symbolPatterns: {
      class: /setClass\s*\(\s*['"](\w+)['"]/,
      export: /^(\w+)\s*<-\s*function/,
      function: /(\w+)\s*<-\s*function\s*\(|^(\w+)\s*=\s*function\s*\(/,
      import: /(?:library|require)\s*\(\s*['"]?(\w+)['"]?\s*\)/,
      variable: /(\w+)\s*(?:<-|=)\s*(?!function)/,
    },
  },
  ruby: {
    extensions: [".rb", ".rake", ".gemspec", ".ru", ".rbw"],
    parser: "ruby",
    symbolPatterns: {
      class: /class\s+(\w+)(?:\s+<\s+[\w:]+)?/,
      export: /module_function\s+:(\w+)|^def\s+(\w+)/,
      function: /def\s+(?:self\.)?(\w+)/,
      import: /require(?:_relative)?\s+['"]([^'"]+)['"]/,
      variable: /(?:@|@@|\$)?(\w+)\s*=(?!=)/,
    },
  },
  rust: {
    extensions: [".rs"],
    parser: "rust",
    symbolPatterns: {
      class:
        /(?:pub(?:\s*\([^)]+\))?\s+)?(?:struct|enum|trait|union|type)\s+(\w+)|impl(?:\s+<[^>]+>)?\s+(?:\w+::)*(\w+)/,
      export: /pub(?:\s*\([^)]+\))?\s+(?:fn|struct|enum|trait|const|static|type|mod|use)\s+(\w+)/,
      function:
        /(?:pub(?:\s*\([^)]+\))?\s+)?(?:unsafe\s+)?(?:async\s+)?(?:const\s+)?(?:extern\s+(?:"[^"]+"\s+)?)?fn\s+(\w+)\s*[<(]/,
      import: /use\s+([^;]+);|extern\s+crate\s+(\w+);/,
      variable: /(?:pub(?:\s*\([^)]+\))?\s+)?(?:static|const|mut)?\s*(?:let\s+(?:mut\s+)?)?(\w+)\s*[:=]/,
    },
  },
  scala: {
    extensions: [".scala", ".sc"],
    parser: "scala",
    symbolPatterns: {
      class: /(?:sealed|abstract|final|implicit)?\s*(?:class|trait|object|case\s+class|case\s+object)\s+(\w+)/,
      export: /^(?:object|class|trait)\s+(\w+)/,
      function: /def\s+(\w+)\s*[:[(]/,
      import: /import\s+([\w.{},\s=>]+)/,
      variable: /(?:val|var|lazy\s+val)\s+(\w+)\s*[:=]/,
    },
  },
  shell: {
    extensions: [".sh", ".bash", ".zsh", ".ksh", ".fish"],
    parser: "shell",
    symbolPatterns: {
      class: /^$/,
      export: /export\s+(?:function\s+)?(\w+)/,
      function: /(?:function\s+)?(\w+)\s*\(\s*\)\s*\{/,
      import: /(?:source|\.)\s+([^\s;]+)/,
      variable: /(?:export\s+)?(\w+)=/,
    },
  },
  sql: {
    extensions: [".sql", ".ddl", ".dml"],
    parser: "sql",
    symbolPatterns: {
      class: /CREATE\s+(?:TABLE|VIEW)\s+(\w+)/i,
      export: /^CREATE\s+(?:FUNCTION|PROCEDURE|VIEW)\s+(\w+)/i,
      function: /CREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE)\s+(\w+)/i,
      import: /^$/,
      variable: /DECLARE\s+@?(\w+)/i,
    },
  },
  svelte: {
    extensions: [".svelte"],
    parser: "svelte",
    symbolPatterns: {
      class: /<[\w-]+/,
      export: /<script[^>]*>[\s\S]*?export\s+(?:let|const|function)\s+(\w+)/,
      function: /<script[^>]*>[\s\S]*?(?:function|const|let|var)\s+(\w+)\s*[=(]/,
      import: /<script[^>]*>[\s\S]*?import\s+(?:{[^}]+}|\w+)\s+from\s+['"]([^'"]+)['"]/,
      variable: /<script[^>]*>[\s\S]*?(?:let|const|var)\s+(\w+)\s*=/,
    },
  },
  swift: {
    extensions: [".swift"],
    parser: "swift",
    symbolPatterns: {
      class:
        /(?:public|private|internal|fileprivate|open)?\s*(?:final)?\s*(?:class|struct|enum|protocol|actor)\s+(\w+)/,
      export: /public\s+(?:func|class|struct|enum|protocol|var|let)\s+(\w+)/,
      function: /(?:public|private|internal|fileprivate|open)?\s*(?:static|class)?\s*func\s+(\w+)\s*[<(]/,
      import: /import\s+(?:class|struct|enum|protocol)?\s*([\w.]+)/,
      variable: /(?:public|private|internal|fileprivate|open)?\s*(?:static|class)?\s*(?:let|var)\s+(\w+)\s*[:=]/,
    },
  },
  toml: {
    extensions: [".toml"],
    parser: "toml",
    symbolPatterns: {
      class: /^\[(\w+(?:\.\w+)*)\]/,
      export: /^\[(\w+(?:\.\w+)*)\]/,
      function: /^$/,
      import: /^$/,
      variable: /^(\w+)\s*=/,
    },
  },
  typescript: {
    extensions: [".ts", ".tsx", ".mts", ".cts"],
    parser: "typescript",
    symbolPatterns: {
      class:
        /(?:export\s+)?(?:abstract\s+)?(?:class|interface)\s+(\w+)|(?:export\s+)?type\s+(\w+)\s*=|(?:export\s+)?enum\s+(\w+)|(?:export\s+)?namespace\s+(\w+)/,
      export:
        /export\s+(?:default\s+)?(?:class|function|const|let|var|interface|type|enum|namespace|abstract\s+class)\s+(\w+)/,
      function:
        /(?:export\s+)?(?:async\s+)?(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\([^)]*\)\s*=>)|(?:@\w+\s+)*(?:public|private|protected|static)?\s*(?:async)?\s*(\w+)\s*[<(]/,
      import: /import\s+(?:type\s+)?(?:{[^}]+}|\w+|\*\s+as\s+\w+)\s+from\s+['"]([^'"]+)['"]/,
      variable:
        /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*(?::|=)|(?:@\w+\s+)*(?:public|private|protected|readonly|static)?\s+(\w+)\s*[?:]/,
    },
  },
  vue: {
    extensions: [".vue"],
    parser: "vue",
    symbolPatterns: {
      class: /<template[^>]*>[\s\S]*?<(\w+)/,
      export: /<script[^>]*>[\s\S]*?export\s+default/,
      function:
        /<script[^>]*>[\s\S]*?(?:export\s+default\s*\{[\s\S]*?)?(?:function|const|let|var)\s+(\w+)|methods\s*:\s*\{[\s\S]*?(\w+)\s*\(/,
      import: /<script[^>]*>[\s\S]*?import\s+(?:{[^}]+}|\w+)\s+from\s+['"]([^'"]+)['"]/,
      variable:
        /<script[^>]*>[\s\S]*?(?:data\s*\(\s*\)\s*\{[\s\S]*?return\s*\{[\s\S]*?(\w+)|(?:const|let|var)\s+(\w+)\s*=)/,
    },
  },
  yaml: {
    extensions: [".yaml", ".yml"],
    parser: "yaml",
    symbolPatterns: {
      class: /^(\w+):$/m,
      export: /^(\w+):$/m,
      function: /^(\w+):\s*\|/m,
      import: /^$/,
      variable: /^(\w+):\s*[^|>]/m,
    },
  },
};

/**
 * 从文件扩展名检测编程语言。
 */
/** detectLanguage 的实现 */
export function detectLanguage(filePath: string): string | null {
  const ext = filePath.substring(filePath.lastIndexOf(".")).toLowerCase();
  for (const [lang, config] of Object.entries(LANGUAGE_CONFIG)) {
    if (config.extensions.includes(ext)) {
      return lang;
    }
  }
  return null;
}
