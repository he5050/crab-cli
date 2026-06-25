/**
 * LSP Manager 高级语义模块 — 定义/references/hover/completion 等语言能力的请求封装。
 *
 * 职责:
 *   - 屏蔽 LspManager 内部细节，向 LspTool 提供开箱即用的高级接口
 *   - 统一通过 deps 注入的 sendRequest/sendNotification 与 Server 通信
 *   - 兼容 1-based 用户坐标与 0-based LSP 坐标
 *
 * 模块功能:
 *   - requestLspLocations: 通用位置类查询(definition / references / implementation / typeDefinition)
 *   - requestLspHover: 悬停信息
 *   - requestLspDocumentSymbols: 文档符号
 *   - requestLspCompletion: 代码补全
 *   - requestLspFormatDocument: 文档格式化
 *   - requestLspRename: 重命名
 *   - requestLspWorkspaceSymbols: 工作区符号
 *   - requestLspCodeActions: 代码操作(quickfix/refactor)
 *   - notifyLspDidOpen / notifyLspDidChange / notifyLspDidClose: 文档同步
 *   - LspFeatureDeps: 依赖注入契约
 *   - LspFeatureClientSnapshot: 客户端快照
 *
 * 使用场景:
 *   - lspTool 直接调用本模块的 request* / notify* 函数
 *
 * 边界:
 *   1. 仅做「坐标转换 + 协议调用 + 结果解析」；不感知具体 Server
 *   2. 不可识别的文件后缀直接返回空(detectLanguage 返回 null)
 *   3. requestLspWorkspaceSymbols 跨多 Server 失败时优雅降级(catch 静默)
 *
 * 流程:
 *   1. 由 LspTool 构造 LspFeatureDeps 注入
 *   2. 调用 requestXxx(deps, ...) → detectLanguage → sendRequest
 *   3. 解析并强转 → 返回上层
 */
import { detectLanguage } from "../language/language";
import {
  type LspCompletionItem,
  type LspDiagnostic,
  type LspLocation,
  type LspSymbol,
  type LspTextEdit,
  type LspWorkspaceEdit,
  parseCompletionItem,
  parseLocation,
  parseSymbol,
  parseTextEdit,
  parseWorkspaceEdit,
} from "./managerProtocol";

export interface LspFeatureClientSnapshot {
  languageId: string;
  state: "stopped" | "starting" | "running" | "error";
}

export interface LspFeatureDeps {
  pathToUri: (filePath: string) => string;
  sendRequest: (languageId: string, method: string, params: unknown, timeoutMs: number) => Promise<unknown>;
  sendNotification: (languageId: string, method: string, params?: unknown) => void;
  getRunningClients: () => LspFeatureClientSnapshot[];
  getDiagnostics: (languageId: string, uri: string) => LspDiagnostic[];
}

export async function requestLspLocations(
  deps: Pick<LspFeatureDeps, "pathToUri" | "sendRequest">,
  method: string,
  filePath: string,
  line: number,
  character: number,
  extra?: Record<string, unknown>,
): Promise<LspLocation[]> {
  const lang = detectLanguage(filePath);
  if (!lang) {
    return [];
  }

  const params = {
    position: { character: character - 1, line: line - 1 },
    textDocument: { uri: deps.pathToUri(filePath) },
    ...extra,
  };

  const result = await deps.sendRequest(lang.languageId, method, params, 5000);
  if (!result) {
    return [];
  }

  if (Array.isArray(result)) {
    return (result as Record<string, unknown>[]).map((r) => parseLocation(r));
  }
  return [parseLocation(result as Record<string, unknown>)];
}

export async function requestLspHover(
  deps: Pick<LspFeatureDeps, "pathToUri" | "sendRequest">,
  filePath: string,
  line: number,
  character: number,
): Promise<{ contents: unknown } | null> {
  const lang = detectLanguage(filePath);
  if (!lang) {
    return null;
  }

  const result = await deps.sendRequest(
    lang.languageId,
    "textDocument/hover",
    {
      position: { character: character - 1, line: line - 1 },
      textDocument: { uri: deps.pathToUri(filePath) },
    },
    5000,
  );

  return result as { contents: unknown } | null;
}

export async function requestLspDocumentSymbols(
  deps: Pick<LspFeatureDeps, "pathToUri" | "sendRequest">,
  filePath: string,
): Promise<LspSymbol[]> {
  const lang = detectLanguage(filePath);
  if (!lang) {
    return [];
  }

  const result = await deps.sendRequest(
    lang.languageId,
    "textDocument/documentSymbol",
    {
      textDocument: { uri: deps.pathToUri(filePath) },
    },
    5000,
  );

  if (!result || !Array.isArray(result)) {
    return [];
  }
  return (result as Record<string, unknown>[]).map((s) => parseSymbol(s));
}

export async function requestLspCompletion(
  deps: Pick<LspFeatureDeps, "pathToUri" | "sendRequest">,
  filePath: string,
  line: number,
  character: number,
): Promise<LspCompletionItem[]> {
  const lang = detectLanguage(filePath);
  if (!lang) {
    return [];
  }

  const result = await deps.sendRequest(
    lang.languageId,
    "textDocument/completion",
    {
      position: { character: character - 1, line: line - 1 },
      textDocument: { uri: deps.pathToUri(filePath) },
    },
    5000,
  );

  if (!result) {
    return [];
  }
  const items = Array.isArray(result) ? result : (result as Record<string, unknown>).items;
  if (!Array.isArray(items)) {
    return [];
  }

  return (items as Record<string, unknown>[]).map((item) => parseCompletionItem(item));
}

export async function requestLspFormatDocument(
  deps: Pick<LspFeatureDeps, "pathToUri" | "sendRequest">,
  filePath: string,
): Promise<LspTextEdit[]> {
  const lang = detectLanguage(filePath);
  if (!lang) {
    return [];
  }

  const result = await deps.sendRequest(
    lang.languageId,
    "textDocument/formatting",
    {
      options: { insertSpaces: true, tabSize: 2 },
      textDocument: { uri: deps.pathToUri(filePath) },
    },
    5000,
  );

  if (!Array.isArray(result)) {
    return [];
  }
  return (result as Record<string, unknown>[]).map((edit) => parseTextEdit(edit));
}

export async function requestLspRename(
  deps: Pick<LspFeatureDeps, "pathToUri" | "sendRequest">,
  filePath: string,
  line: number,
  character: number,
  newName: string,
): Promise<LspWorkspaceEdit | null> {
  const lang = detectLanguage(filePath);
  if (!lang) {
    return null;
  }

  const result = await deps.sendRequest(
    lang.languageId,
    "textDocument/rename",
    {
      newName,
      position: { character: character - 1, line: line - 1 },
      textDocument: { uri: deps.pathToUri(filePath) },
    },
    5000,
  );

  if (!result) {
    return null;
  }
  return parseWorkspaceEdit(result as Record<string, unknown>);
}

export async function requestLspWorkspaceSymbols(
  deps: Pick<LspFeatureDeps, "sendRequest" | "getRunningClients">,
  query: string,
): Promise<LspSymbol[]> {
  if (!query.trim()) {
    return [];
  }

  for (const client of deps.getRunningClients()) {
    if (client.state !== "running") {
      continue;
    }

    try {
      const result = await deps.sendRequest(client.languageId, "workspace/symbol", { query }, 8000);
      if (!result) {
        continue;
      }

      const symbols = Array.isArray(result) ? (result as Record<string, unknown>[]).map((s) => parseSymbol(s)) : [];
      if (symbols.length > 0) {
        return symbols;
      }
    } catch {
      // Try the next running client.
    }
  }

  return [];
}

export async function requestLspCodeActions(
  deps: Pick<LspFeatureDeps, "pathToUri" | "sendRequest" | "getDiagnostics">,
  filePath: string,
  line: number,
  character: number,
  diagnostics?: { line: number; column: number; message: string }[],
): Promise<{ title: string; kind?: string; command?: string }[]> {
  const lang = detectLanguage(filePath);
  if (!lang) {
    return [];
  }

  const uri = deps.pathToUri(filePath);
  const cachedDiags = deps.getDiagnostics(lang.languageId, uri);

  const buildRange = (d: LspDiagnostic | { line: number; column: number; message: string }) =>
    "location" in d
      ? { message: d.message, range: { end: d.location.range.start, start: d.location.range.start } }
      : {
          message: d.message,
          range: {
            end: { character: d.column + 20, line: d.line - 1 },
            start: { character: d.column - 1, line: d.line - 1 },
          },
        };

  const contextDiagnostics = cachedDiags.length > 0 ? cachedDiags.map(buildRange) : (diagnostics ?? []).map(buildRange);

  const result = await deps.sendRequest(
    lang.languageId,
    "textDocument/codeAction",
    {
      context: { diagnostics: contextDiagnostics },
      range: {
        end: { character: character + 1, line: line - 1 },
        start: { character: character - 1, line: line - 1 },
      },
      textDocument: { uri },
    },
    5000,
  );

  if (!result || !Array.isArray(result)) {
    return [];
  }

  return result.map((action: Record<string, unknown>) => ({
    command: action.command as string | undefined,
    kind: action.kind as string | undefined,
    title: (action.title as string) ?? "",
  }));
}

export function notifyLspDidOpen(
  deps: Pick<LspFeatureDeps, "pathToUri" | "sendNotification">,
  filePath: string,
  content: string,
): void {
  const lang = detectLanguage(filePath);
  if (!lang) {
    return;
  }

  deps.sendNotification(lang.languageId, "textDocument/didOpen", {
    textDocument: {
      languageId: lang.languageId,
      text: content,
      uri: deps.pathToUri(filePath),
      version: 0,
    },
  });
}

export function notifyLspDidChange(
  deps: Pick<LspFeatureDeps, "pathToUri" | "sendNotification">,
  filePath: string,
  content: string,
  version: number,
): void {
  const lang = detectLanguage(filePath);
  if (!lang) {
    return;
  }

  deps.sendNotification(lang.languageId, "textDocument/didChange", {
    contentChanges: [{ text: content }],
    textDocument: { uri: deps.pathToUri(filePath), version },
  });
}

export function notifyLspDidClose(
  deps: Pick<LspFeatureDeps, "pathToUri" | "sendNotification">,
  filePath: string,
): void {
  const lang = detectLanguage(filePath);
  if (!lang) {
    return;
  }

  deps.sendNotification(lang.languageId, "textDocument/didClose", {
    textDocument: { uri: deps.pathToUri(filePath) },
  });
}
