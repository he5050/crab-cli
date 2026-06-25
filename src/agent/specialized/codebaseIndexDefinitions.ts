/**
 * 代码库索引定义
 *
 * 职责:
 *   - 定义代码库索引相关的类型和常量
 *   - 提供文件分类和过滤函数
 */

import { createLogger } from "@/core/logging/logger";

const log = createLogger("agent:codebase-index-defs");

/** 文件类型 */
export type FileType = "source" | "config" | "test" | "doc" | "asset" | "other";

/** 索引文件信息 */
export interface IndexedFile {
  path: string;
  name: string;
  extension: string;
  type: FileType;
  language?: string;
  size: number;
  lineCount?: number;
  isEntry?: boolean;
}

/** 目录节点 */
export interface DirectoryNode {
  name: string;
  path: string;
  children: DirectoryNode[];
  files: IndexedFile[];
  depth?: number;
  fileCount?: number;
}

/** 技术栈信息 */
export interface TechStack {
  languages: string[];
  frameworks: string[];
  packageManager?: string;
  buildTools?: string[];
}

/** 索引统计 */
export interface IndexStatistics {
  totalFiles: number;
  totalDirectories: number;
  sourceFiles: number;
  configFiles: number;
  testFiles: number;
  docFiles: number;
  assetFiles?: number;
  otherFiles?: number;
  totalSize?: number;
  byLanguage: Record<string, number>;
  byType?: Record<string, number>;
}

/** 代码库索引配置 */
export interface CodebaseIndexConfig {
  maxFiles?: number;
  maxFileSize?: number;
  maxDepth?: number;
  includePatterns?: string[];
  excludePatterns?: string[];
  ignoreDirs?: string[];
  ignoreExtensions?: string[];
  includeNodeModules?: boolean;
  includeGit?: boolean;
}

/** 代码库索引结果 */
export interface CodebaseIndexResult {
  success: boolean;
  error?: string;
  errorCode?: string;
  rootPath: string;
  projectName?: string;
  techStack: TechStack;
  statistics: IndexStatistics;
  directoryTree: DirectoryNode;
  keyFiles: string[];
  allFiles: IndexedFile[];
}

/** 默认配置 */
export const DEFAULT_CONFIG: Required<CodebaseIndexConfig> = {
  excludePatterns: [],
  ignoreDirs: [
    "node_modules",
    ".git",
    "dist",
    "build",
    ".next",
    ".nuxt",
    "coverage",
    ".coverage",
    "__pycache__",
    ".pytest_cache",
    ".idea",
    ".vscode",
    "target",
    "out",
    "bin",
    "obj",
  ],
  ignoreExtensions: [".log", ".lock", ".map", ".min.js", ".min.css", ".bundle.js"],
  includeGit: false,
  includeNodeModules: false,
  includePatterns: [],
  maxDepth: 10,
  maxFileSize: 1024 * 1024, // 1MB
  maxFiles: 10_000,
};

/** 扩展名到语言映射 */
export const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  ".bash": "Shell",
  ".c": "C",
  ".cpp": "C++",
  ".cs": "C#",
  ".css": "CSS",
  ".fish": "Shell",
  ".go": "Go",
  ".h": "C/C++",
  ".hpp": "C++",
  ".htm": "HTML",
  ".html": "HTML",
  ".java": "Java",
  ".js": "JavaScript",
  ".json": "JSON",
  ".jsx": "JavaScript",
  ".kt": "Kotlin",
  ".less": "Less",
  ".m": "Objective-C",
  ".md": "Markdown",
  ".mdx": "MDX",
  ".mm": "Objective-C++",
  ".php": "PHP",
  ".ps1": "PowerShell",
  ".py": "Python",
  ".r": "R",
  ".rb": "Ruby",
  ".rs": "Rust",
  ".rst": "reStructuredText",
  ".sass": "Sass",
  ".scala": "Scala",
  ".scss": "SCSS",
  ".sh": "Shell",
  ".sql": "SQL",
  ".svelte": "Svelte",
  ".swift": "Swift",
  ".toml": "TOML",
  ".ts": "TypeScript",
  ".tsx": "TypeScript",
  ".vue": "Vue",
  ".xml": "XML",
  ".yaml": "YAML",
  ".yml": "YAML",
  ".zsh": "Shell",
};

/** 技术栈指示器 */
export const TECH_STACK_INDICATORS: Record<string, string[]> = {
  Angular: ["angular", "@angular"],
  Django: ["django"],
  Express: ["express"],
  FastAPI: ["fastapi"],
  Fastify: ["fastify"],
  Flask: ["flask"],
  Laravel: ["laravel"],
  NestJS: ["@nestjs"],
  Next: ["next", "next.js"],
  Nuxt: ["nuxt", "nuxt.js"],
  Rails: ["rails", "ruby on rails"],
  React: ["react", "jsx", "tsx"],
  Spring: ["spring", "spring-boot"],
  Svelte: ["svelte"],
  Vue: ["vue", "vuex", "vue-router"],
};

/** 判断是否应该忽略目录 */
export function shouldIgnoreDir(dirName: string, ignoreDirs?: string[]): boolean {
  const dirsToIgnore = ignoreDirs ?? DEFAULT_CONFIG.ignoreDirs;
  return dirsToIgnore.some(
    (pattern) =>
      dirName === pattern || dirName.startsWith(`.`) || dirName.match(new RegExp(`^${pattern.replace(/\*/g, ".*")}$`)),
  );
}

/** 判断是否应该忽略扩展名 */
export function shouldIgnoreExtension(ext: string, ignoreExts?: string[]): boolean {
  const extsToIgnore = ignoreExts ?? DEFAULT_CONFIG.ignoreExtensions;
  return extsToIgnore.some((pattern) => ext === pattern || ext.match(new RegExp(`^${pattern.replace(/\*/g, ".*")}$`)));
}

/** 分类文件 */
export function classifyFile(fileName: string, ext: string): FileType {
  const testPatterns = [".test.", ".spec.", "_test.", "_spec.", "test_", "spec_", "__tests__", "__mocks__"];
  if (testPatterns.some((p) => fileName.includes(p))) {
    return "test";
  }

  const configPatterns = [
    ".config.",
    "config.",
    ".rc",
    "rc.",
    ".env",
    "tsconfig",
    "jsconfig",
    "package.json",
    "Cargo.toml",
    "go.mod",
    "requirements.txt",
    "Pipfile",
    "poetry.lock",
    "Gemfile",
    "pom.xml",
    "build.gradle",
  ];
  if (configPatterns.some((p) => fileName.toLowerCase().includes(p.toLowerCase()))) {
    return "config";
  }

  const docPatterns = [".md", ".mdx", ".rst", ".txt", "README", "LICENSE", "CHANGELOG"];
  if (docPatterns.some((p) => fileName.toLowerCase().includes(p.toLowerCase()))) {
    return "doc";
  }

  const assetPatterns = [
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".svg",
    ".ico",
    ".woff",
    ".woff2",
    ".ttf",
    ".eot",
    ".mp3",
    ".mp4",
    ".webm",
    ".pdf",
  ];
  if (assetPatterns.includes(ext.toLowerCase())) {
    return "asset";
  }

  const sourceExts = [
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".py",
    ".java",
    ".kt",
    ".go",
    ".rs",
    ".cpp",
    ".c",
    ".h",
    ".hpp",
    ".cs",
    ".rb",
    ".php",
    ".swift",
    ".m",
    ".mm",
    ".scala",
    ".r",
    ".sql",
    ".sh",
    ".bash",
    ".zsh",
    ".fish",
    ".ps1",
    ".html",
    ".htm",
    ".css",
    ".scss",
    ".sass",
    ".less",
    ".vue",
    ".svelte",
  ];
  if (sourceExts.includes(ext.toLowerCase())) {
    return "source";
  }

  return "other";
}

/** 判断是否是入口文件 */
export function isEntryFile(fileName: string): boolean {
  const entryPatterns = [
    /^index\./i,
    /^main\./i,
    /^app\./i,
    /^server\./i,
    /^cli\./i,
    /^entry\./i,
    /^bootstrap\./i,
    /^start\./i,
  ];
  return entryPatterns.some((pattern) => pattern.test(fileName));
}
