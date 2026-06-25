/**
 * LSP 操作处理函数 — 定义跳转、引用、悬浮、诊断、符号、代码操作。
 */
import { escapeRegex } from "@/tool/shared";
import { exec } from "@/bus";
import { lspManager } from "@/lsp/index";
import fs from "node:fs";
import path from "node:path";
import {
  uriToPath,
  parseRgOutput,
  extractSymbolAtPosition,
  extractSymbols,
  flattenSymbols,
  jsSearchDefinition,
  jsSearchReferences,
} from "./lspHandlerHelpers";

// ── 跳转定义 ──────────────────────────────────────────────────────

/** 查找符号的定义位置，优先使用 LSP，回退到 regex 和纯 JS 搜索 */
export async function findDefinition(
  filePath: string,
  line?: number,
  column?: number,
  symbol?: string,
  cwd?: string,
): Promise<Record<string, unknown>> {
  const ln = line ?? 1;
  const col = column ?? 1;

  // 策略 1:尝试真实 LSP
  const lspLocations = await lspManager.gotoDefinition(filePath, ln, col);
  if (lspLocations.length > 0) {
    const results = lspLocations.map((loc) => ({
      column: loc.range.start.character + 1,
      file: uriToPath(loc.uri),
      line: loc.range.start.line + 1,
      text: "",
    }));
    return {
      action: "definition",
      engine: "lsp",
      file: filePath,
      results,
      success: true,
      symbol,
      total: results.length,
    };
  }

  // 策略 2:regex 回退
  const targetSymbol = symbol ?? extractSymbolAtPosition(filePath, line, column);
  if (!targetSymbol) {
    return { action: "definition", error: "需要提供 symbol 或 line/column 来定位符号", file: filePath, success: false };
  }

  const patterns = [
    `function\\s+${escapeRegex(targetSymbol)}`,
    `(?:export\\s+)?(?:default\\s+)?(?:class|interface|type|enum)\\s+${escapeRegex(targetSymbol)}`,
    `(?:export\\s+)?(?:const|let|var)\\s+${escapeRegex(targetSymbol)}\\s*[=:]`,
  ];

  try {
    const result = await exec(
      [
        "rg",
        "--line-number",
        "--no-heading",
        "--color=never",
        "--max-count",
        "20",
        "--glob",
        "!node_modules",
        "--glob",
        "!*.d.ts",
        "--",
        patterns.map((p) => `(${p})`).join("|"),
        cwd ?? path.dirname(filePath),
      ],
      { cwd, timeout: 10_000 },
    );
    if (result.exitCode === 0 && result.stdout.trim()) {
      const results = parseRgOutput(result.stdout);
      return {
        action: "definition",
        engine: "regex-fallback",
        file: filePath,
        results,
        success: true,
        symbol: targetSymbol,
        total: results.length,
      };
    }
    // Rg 不可用或无匹配 → 纯 JS 回退
    if (result.exitCode === 1) {
      return {
        action: "definition",
        engine: "regex-fallback",
        file: filePath,
        results: [],
        success: true,
        symbol: targetSymbol,
        total: 0,
      };
    }
  } catch {
    /* Rg failed, fall through to JS */
  }

  // 策略 3:纯 JS 搜索回退
  const results = jsSearchDefinition(targetSymbol, cwd ?? path.dirname(filePath));
  return {
    action: "definition",
    engine: "js-fallback",
    file: filePath,
    results,
    success: true,
    symbol: targetSymbol,
    total: results.length,
  };
}

// ── 查找引用 ──────────────────────────────────────────────────────

/** 查找符号的所有引用位置，优先使用 LSP，回退到 regex 和纯 JS 搜索 */
export async function findReferences(
  filePath: string,
  line?: number,
  column?: number,
  symbol?: string,
  cwd?: string,
): Promise<Record<string, unknown>> {
  const ln = line ?? 1;
  const col = column ?? 1;

  // 策略 1:尝试真实 LSP
  const lspLocations = await lspManager.findReferences(filePath, ln, col);
  if (lspLocations.length > 0) {
    const results = lspLocations.map((loc) => ({
      column: loc.range.start.character + 1,
      file: uriToPath(loc.uri),
      line: loc.range.start.line + 1,
      text: "",
    }));
    return {
      action: "references",
      engine: "lsp",
      file: filePath,
      results,
      success: true,
      symbol,
      total: results.length,
    };
  }

  // 策略 2:regex 回退
  const targetSymbol = symbol ?? extractSymbolAtPosition(filePath, line, column);
  if (!targetSymbol) {
    return { action: "references", error: "需要提供 symbol 或 line/column", file: filePath, success: false };
  }

  try {
    const result = await exec(
      [
        "rg",
        "--line-number",
        "--no-heading",
        "--color=never",
        "--max-count",
        "50",
        "--word-regexp",
        "--glob",
        "!node_modules",
        "--",
        targetSymbol,
        cwd ?? path.dirname(filePath),
      ],
      { cwd, timeout: 10_000 },
    );
    if (result.exitCode === 0) {
      const results = parseRgOutput(result.stdout);
      return {
        action: "references",
        engine: "regex-fallback",
        file: filePath,
        results,
        success: true,
        symbol: targetSymbol,
        total: results.length,
      };
    }
    if (result.exitCode === 1) {
      return {
        action: "references",
        engine: "regex-fallback",
        file: filePath,
        results: [],
        success: true,
        symbol: targetSymbol,
        total: 0,
      };
    }
    // ExitCode=-1 或 2 → rg 不可用，回退到 JS
  } catch {
    /* Rg failed, fall through */
  }

  // 策略 3:纯 JS 搜索回退
  const results = jsSearchReferences(targetSymbol, cwd ?? path.dirname(filePath));
  return {
    action: "references",
    engine: "js-fallback",
    file: filePath,
    results,
    success: true,
    symbol: targetSymbol,
    total: results.length,
  };
}

// ── 悬浮信息 ──────────────────────────────────────────────────────

/** 获取指定位置的悬浮类型信息，优先使用 LSP，回退到行内容读取 */
export async function getHoverInfo(filePath: string, line?: number, column?: number): Promise<Record<string, unknown>> {
  if (!line) {
    return { action: "hover", error: "hover 需要提供 line 参数", file: filePath, success: false };
  }
  const col = column ?? 1;

  // 策略 1:尝试真实 LSP hover（5 秒超时）
  try {
    const lspResult = await Promise.race([
      lspManager.hover(filePath, line, col),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000)),
    ]);
    if (lspResult && lspResult.contents) {
      const contents = lspResult.contents;
      let hoverText: string;
      if (typeof contents === "string") {
        hoverText = contents;
      } else if (typeof contents === "object" && contents !== null && "value" in contents) {
        const entry = contents;
        hoverText = String("value" in entry ? entry.value : "");
      } else {
        hoverText = String(contents);
      }

      return {
        action: "hover",
        column: col,
        engine: "lsp",
        file: filePath,
        line,
        success: true,
        text: hoverText,
        typeInfo: hoverText,
      };
    }
  } catch {
    // LSP 不可用或超时，回退到行读取
  }

  // 策略 2:回退到读取源码行文本
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const targetLine = content.split("\n")[line - 1]?.trim() ?? "";

    return {
      action: "hover",
      column: col,
      engine: "line-reading",
      file: filePath,
      line,
      success: true,
      text: targetLine,
      typeInfo: "LSP 服务器未连接，无法获取类型信息(回退到行内容展示)",
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { action: "hover", error: msg, file: filePath, success: false };
  }
}

// ── 诊断 ──────────────────────────────────────────────────────────

/** 获取文件的诊断信息（错误/警告），优先使用 LSP 缓存 */
export async function getDiagnostics(filePath: string): Promise<Record<string, unknown>> {
  // 策略 1:尝试从 lspManager 获取缓存诊断(不主动等待真实 server)
  const lspDiags = lspManager.getDiagnostics(filePath);
  if (lspDiags.length > 0) {
    const diagnostics = lspDiags.map((d) => ({
      line: d.location.range.start.line + 1,
      message: d.message,
      severity: d.severity,
      source: d.source,
    }));
    return {
      action: "diagnostics",
      diagnostics,
      engine: "lsp",
      file: filePath,
      success: true,
      total: diagnostics.length,
    };
  }

  // 策略 2:快速空结果回退，避免无 LSP/无项目配置时卡住
  return {
    action: "diagnostics",
    diagnostics: [],
    engine: "fallback-empty",
    file: filePath,
    success: true,
    total: 0,
  };
}

// ── 文档符号 ──────────────────────────────────────────────────────

/** 获取文件的文档符号列表，优先使用 LSP，回退到 regex 提取 */
export async function getDocumentSymbols(filePath: string, _cwd?: string): Promise<Record<string, unknown>> {
  // 策略 1:尝试真实 LSP
  const lspSymbols = await lspManager.documentSymbols(filePath);
  if (lspSymbols.length > 0) {
    const symbols = flattenSymbols(lspSymbols);
    return { action: "symbols", engine: "lsp", file: filePath, success: true, symbols, total: symbols.length };
  }

  // 策略 2:regex 回退
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const symbols = extractSymbols(content, filePath);
    return { action: "symbols", engine: "regex", file: filePath, success: true, symbols, total: symbols.length };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { action: "symbols", error: msg, file: filePath, success: false };
  }
}

// ── 工作区符号搜索 ─────────────────────────────────────────────

/** 在整个工作区中搜索符号，基于 LSP workspace/symbols */
export async function getWorkspaceSymbols(query: string): Promise<Record<string, unknown>> {
  try {
    const symbols = await lspManager.workspaceSymbols(query);
    if (symbols.length > 0) {
      return {
        action: "workspaceSymbols",
        engine: "lsp",
        query,
        results: symbols.map((s) => ({
          column: s.location.range.start.character + 1,
          file: s.location.uri ? s.location.uri.replace(/^file:\/\//, "") : "",
          kind: s.kind,
          line: s.location.range.start.line + 1,
          name: s.name,
        })),
        success: true,
        total: symbols.length,
      };
    }
    return { action: "workspaceSymbols", engine: "lsp-empty", query, results: [], success: true, total: 0 };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { action: "workspaceSymbols", error: msg, query, success: false };
  }
}

// ── 代码操作/快速修复 ────────────────────────────────────────────

/** 获取指定位置的可用代码操作（快速修复），基于 LSP codeAction */
export async function getCodeActions(filePath: string, line: number, column: number): Promise<Record<string, unknown>> {
  try {
    const actions = await lspManager.codeActions(filePath, line, column);
    if (actions.length > 0) {
      return {
        action: "codeActions",
        column,
        engine: "lsp",
        file: filePath,
        line,
        results: actions,
        success: true,
        total: actions.length,
      };
    }
    return { action: "codeActions", engine: "lsp-empty", file: filePath, line, results: [], success: true, total: 0 };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { action: "codeActions", error: msg, file: filePath, success: false };
  }
}
