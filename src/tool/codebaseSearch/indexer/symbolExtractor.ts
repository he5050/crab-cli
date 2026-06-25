/**
 * SymbolExtractor 模块
 *
 * 职责:
 *   - 从源代码文件中提取符号(函数、类、接口、方法等)
 *   - 优先使用 LSP documentSymbols API 获取精确符号信息
 *   - 回退到简单正则提取(当 LSP 不可用时)
 *   - 生成符号的唯一 ID 和签名
 *
 * 模块功能:
 *   - SymbolExtractor 类:符号提取器核心类
 *   - extractSymbols: 从文件提取所有符号
 *   - convertLspSymbols: 将 LSP 符号转换为标准格式
 *   - regexExtractSymbols: 正则表达式回退方案
 *
 * 使用场景:
 *   - 代码库索引时提取符号信息
 *   - 符号级搜索的数据源
 *   - 代码导航和跳转
 *
 * 边界:
 *   1. 依赖 LSP 服务的可用性
 *   2. 正则提取不如 LSP 精确，可能有误报
 *   3. 仅提取顶层和一级嵌套符号
 *   4. 不提取局部变量和临时符号
 *
 * 流程:
 *   1. 尝试使用 LSP documentSymbols 获取符号
 *   2. 如果 LSP 不可用，使用正则提取
 *   3. 转换为标准 SymbolInfo 格式
 *   4. 生成唯一 ID 和签名
 */
import { createLogger } from "@/core/logging/logger";
import { lspManager } from "@/lsp/index";
import { detectLanguage } from "@/lsp/language/language";
import { existsSync, readFileSync } from "node:fs";
import { relative } from "node:path";

const log = createLogger("search:symbol-extractor");

/** 符号类型 */
export type SymbolKind =
  | "function"
  | "class"
  | "interface"
  | "method"
  | "property"
  | "enum"
  | "constant"
  | "variable"
  | "type"
  | "namespace"
  | "module";

/** 符号信息 */
export interface SymbolInfo {
  /** 唯一 ID */
  id: string;
  /** 符号名称 */
  name: string;
  /** 符号类型 */
  kind: SymbolKind;
  /** 文件路径 */
  filePath: string;
  /** 起始行(1-based) */
  startLine: number;
  /** 结束行(1-based) */
  endLine: number;
  /** 符号签名(如函数声明、类定义) */
  signature?: string;
  /** 所属容器(类名、命名空间等) */
  containerName?: string;
  /** 语言 ID */
  languageId: string;
}

/** LSP 符号类型到标准类型的映射 */
const LSP_KIND_MAP: Record<number, SymbolKind> = {
  1: "module", // File
  10: "enum", // Enum
  11: "interface", // Interface
  12: "function", // Function
  13: "variable", // Variable
  14: "constant", // Constant
  15: "constant", // String (常量)
  16: "constant", // Number (常量)
  17: "constant", // Boolean (常量)
  18: "constant", // Array (常量)
  2: "module", // Module
  22: "type", // Struct
  23: "type", // Event
  24: "function", // Operator
  25: "type", // TypeParameter
  3: "namespace", // Namespace
  4: "namespace", // Package
  5: "class", // Class
  6: "method", // Method
  7: "property", // Property
  8: "property", // Field
  9: "function", // Constructor (视为特殊函数)
};

/**
 * 符号提取器。
 */
/** SymbolExtractor */
export class SymbolExtractor {
  private rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
  }

  /**
   * 从文件提取符号。
   *
   * 策略:
   *   1. 优先使用 LSP documentSymbols(精确)
   *   2. LSP 不可用时回退到正则提取(简单但不够精确)
   */
  async extractSymbols(filePath: string): Promise<SymbolInfo[]> {
    if (!existsSync(filePath)) {
      return [];
    }

    const lang = detectLanguage(filePath);
    if (!lang) {
      return [];
    }

    // 尝试 LSP 符号提取
    try {
      const lspSymbols = await lspManager.documentSymbols(filePath);
      if (lspSymbols && lspSymbols.length > 0) {
        log.debug(`LSP 提取符号: ${relative(this.rootDir, filePath)} → ${lspSymbols.length} 个`);
        return this.convertLspSymbols(lspSymbols, filePath, lang.languageId);
      }
    } catch {
      log.debug(`LSP 提取失败，回退到正则: ${relative(this.rootDir, filePath)}`);
    }

    // 回退:正则提取
    const symbols = this.regexExtractSymbols(filePath, lang.languageId);
    log.debug(`正则提取符号: ${relative(this.rootDir, filePath)} → ${symbols.length} 个`);
    return symbols;
  }

  /**
   * 将 LSP documentSymbols 转换为标准 SymbolInfo 格式。
   */
  private convertLspSymbols(
    lspSymbols: any[],
    filePath: string,
    languageId: string,
    containerName?: string,
  ): SymbolInfo[] {
    const result: SymbolInfo[] = [];

    for (const sym of lspSymbols) {
      const kind = LSP_KIND_MAP[sym.kind] ?? "variable";
      const startLine = sym.range?.start?.line ? sym.range.start.line + 1 : 1;
      const endLine = sym.range?.end?.line ? sym.range.end.line + 1 : startLine;

      const symbolInfo: SymbolInfo = {
        containerName,
        endLine,
        filePath,
        id: `${filePath}:${startLine}:${sym.name}`,
        kind,
        languageId,
        name: sym.name,
        signature: sym.detail || undefined,
        startLine,
      };

      result.push(symbolInfo);

      // 递归处理嵌套符号(如类中的方法)
      if (sym.children && sym.children.length > 0) {
        const nestedSymbols = this.convertLspSymbols(sym.children, filePath, languageId, sym.name);
        result.push(...nestedSymbols);
      }
    }

    return result;
  }

  /**
   * 使用正则表达式提取符号(回退方案)。
   *
   * 策略:
   *   - TypeScript/JavaScript: function/class/interface/const/let/var
   *   - Python: def/class
   *   - 其他语言暂不支持
   */
  private regexExtractSymbols(filePath: string, languageId: string): SymbolInfo[] {
    const content = readFileSync(filePath, "utf8");
    const lines = content.split("\n");
    const symbols: SymbolInfo[] = [];

    if (
      languageId === "typescript" ||
      languageId === "javascript" ||
      languageId === "typescriptreact" ||
      languageId === "javascriptreact"
    ) {
      // TypeScript/JavaScript 正则
      const patterns: Array<{ kind: SymbolKind; regex: RegExp }> = [
        // Function foo() / async function foo() / export function foo()
        { kind: "function", regex: /(?:export\s+)?(?:async\s+)?function\s+(\w+)/g },
        // Class Foo / export class Foo / export default class Foo
        { kind: "class", regex: /(?:export\s+)?(?:default\s+)?class\s+(\w+)/g },
        // Interface Foo / export interface Foo
        { kind: "interface", regex: /(?:export\s+)?interface\s+(\w+)/g },
        // Type Foo = / export type Foo =
        { kind: "type", regex: /(?:export\s+)?type\s+(\w+)\s*=/g },
        // Const foo = / export const foo =
        { kind: "constant", regex: /(?:export\s+)?const\s+(\w+)\s*=/g },
        // Enum Foo / export enum Foo
        { kind: "enum", regex: /(?:export\s+)?enum\s+(\w+)/g },
      ];

      for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
        const line = lines[lineIdx]!;
        for (const { regex, kind } of patterns) {
          let match: RegExpExecArray | null;
          while ((match = regex.exec(line)) !== null) {
            const name = match[1]!;
            symbols.push({
              endLine: lineIdx + 1, // 简化:单行
              filePath,
              id: `${filePath}:${lineIdx + 1}:${name}`,
              kind,
              languageId,
              name,
              signature: line.trim(),
              startLine: lineIdx + 1,
            });
          }
        }
      }
    } else if (languageId === "python") {
      // Python 正则
      const patterns: Array<{ kind: SymbolKind; regex: RegExp }> = [
        // Def foo(): / async def foo():
        { kind: "function", regex: /(?:async\s+)?def\s+(\w+)\s*\(/g },
        // Class Foo: / class Foo():
        { kind: "class", regex: /class\s+(\w+)[\s(:]/g },
      ];

      for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
        const line = lines[lineIdx]!;
        for (const { regex, kind } of patterns) {
          let match: RegExpExecArray | null;
          while ((match = regex.exec(line)) !== null) {
            const name = match[1]!;
            symbols.push({
              endLine: lineIdx + 1,
              filePath,
              id: `${filePath}:${lineIdx + 1}:${name}`,
              kind,
              languageId,
              name,
              signature: line.trim(),
              startLine: lineIdx + 1,
            });
          }
        }
      }
    }
    // 其他语言暂不支持正则提取

    return symbols;
  }
}
