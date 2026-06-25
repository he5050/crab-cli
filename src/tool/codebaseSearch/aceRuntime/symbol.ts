/**
 * ACE Code Search 符号解析工具 — 从源代码中提取代码符号
 *
 * 职责:
 *   - 解析文件内容提取代码符号(函数、类、变量、导入、导出)
 *   - 提供上下文行提取功能
 *   - 使用正则模式进行语言无关的符号解析
 *
 * 模块功能:
 *   - getContext: 获取指定行周围的上下文行
 *   - parseFileSymbols: 解析文件内容提取代码符号，返回 CodeSymbol[]
 *   - ParseFileSymbolsOptions: 符号解析选项接口定义
 *
 * 使用场景:
 *   - 代码符号索引构建
 *   - 文件大纲生成
 *   - 代码导航和跳转
 *
 * 边界:
 * 1. 支持提取的符号类型:function、class、variable、import、export
 * 2. 依赖 LANGUAGE_CONFIG 中的正则模式
 * 3. 可选的上下文和签名信息提取
 * 4. 支持最大符号数限制
 *
 * 流程:
 * 1. 根据文件扩展名检测语言
 * 2. 获取对应语言的正则模式配置
 * 3. 按行遍历文件内容
 * 4. 使用正则匹配各类符号
 * 5. 提取符号信息(名称、类型、位置、签名、上下文)
 * 6. 返回 CodeSymbol 数组
 */

import { relative } from "node:path";
import type { CodeSymbol } from "./types";
import { LANGUAGE_CONFIG, detectLanguage } from "./language";

/** 获取指定行周围的上下文行 */
export function getContext(lines: string[], lineIndex: number, contextSize: number): string {
  const start = Math.max(0, lineIndex - contextSize);
  const end = Math.min(lines.length, lineIndex + contextSize + 1);
  return lines
    .slice(start, end)
    .filter((l) => l !== undefined)
    .join("\n")
    .trim();
}

/** 符号解析选项 */
export interface ParseFileSymbolsOptions {
  includeContext?: boolean;
  includeSignature?: boolean;
  maxSymbols?: number;
}

/**
 * 解析文件内容提取代码符号。
 * 使用正则模式从源代码中提取函数、类、变量、导入和导出。
 */
export async function parseFileSymbols(
  filePath: string,
  content: string,
  basePath: string,
  options: ParseFileSymbolsOptions = {},
): Promise<CodeSymbol[]> {
  const symbols: CodeSymbol[] = [];
  const language = detectLanguage(filePath);

  if (!language || !LANGUAGE_CONFIG[language]) {
    return symbols;
  }

  const { includeContext = true, includeSignature = true, maxSymbols } = options;
  const config = LANGUAGE_CONFIG[language]!;
  const lines = content.split("\n");
  const relativeFilePath = relative(basePath, filePath);

  const pushSymbol = (symbol: CodeSymbol): boolean => {
    symbols.push(symbol);
    return maxSymbols !== undefined && symbols.length >= maxSymbols;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) {
      continue;
    }
    const lineNumber = i + 1;

    // 提取函数
    if (config.symbolPatterns.function) {
      const match = line.match(config.symbolPatterns.function);
      if (match) {
        const name = match[1] || match[2] || match[3];
        if (name) {
          const contextLines = lines.slice(i, Math.min(i + 3, lines.length));
          if (
            pushSymbol({
              column: line.indexOf(name) + 1,
              context: includeContext ? getContext(lines, i, 2) : undefined,
              filePath: relativeFilePath,
              language,
              line: lineNumber,
              name,
              signature: includeSignature ? contextLines.join("\n").trim() : undefined,
              type: "function",
            })
          ) {
            return symbols;
          }
        }
      }
    }

    // 提取类
    if (config.symbolPatterns.class) {
      const match = line.match(config.symbolPatterns.class);
      if (match) {
        const name = match[1] || match[2] || match[3];
        if (name) {
          if (
            pushSymbol({
              column: line.indexOf(name) + 1,
              context: includeContext ? getContext(lines, i, 2) : undefined,
              filePath: relativeFilePath,
              language,
              line: lineNumber,
              name,
              signature: includeSignature ? line.trim() : undefined,
              type: "class",
            })
          ) {
            return symbols;
          }
        }
      }
    }

    // 提取变量
    if (config.symbolPatterns.variable) {
      const match = line.match(config.symbolPatterns.variable);
      if (match) {
        const name = match[1];
        if (name) {
          if (
            pushSymbol({
              column: line.indexOf(name) + 1,
              context: includeContext ? getContext(lines, i, 1) : undefined,
              filePath: relativeFilePath,
              language,
              line: lineNumber,
              name,
              signature: includeSignature ? line.trim() : undefined,
              type: "variable",
            })
          ) {
            return symbols;
          }
        }
      }
    }

    // 提取导入
    if (config.symbolPatterns.import) {
      const match = line.match(config.symbolPatterns.import);
      if (match) {
        const name = match[1] || match[2];
        if (name) {
          if (
            pushSymbol({
              column: line.indexOf(name) + 1,
              filePath: relativeFilePath,
              language,
              line: lineNumber,
              name,
              signature: includeSignature ? line.trim() : undefined,
              type: "import",
            })
          ) {
            return symbols;
          }
        }
      }
    }

    // 提取导出
    if (config.symbolPatterns.export) {
      const match = line.match(config.symbolPatterns.export);
      if (match) {
        const name = match[1];
        if (name) {
          if (
            pushSymbol({
              column: line.indexOf(name) + 1,
              filePath: relativeFilePath,
              language,
              line: lineNumber,
              name,
              signature: includeSignature ? line.trim() : undefined,
              type: "export",
            })
          ) {
            return symbols;
          }
        }
      }
    }
  }

  return symbols;
}
