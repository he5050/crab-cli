// ── LSP 类型定义（LSPClient 内部协议）────────────────────────────────
// 注意: 此文件定义的类型遵循 LSP 规范的原始格式（severity 为数字等），
// 仅供 core/client.ts (LSPClient) 内部使用。
// 公共 API 类型统一定义在 manager/managerProtocol.ts（severity 为字符串）。

/** LSP 位置 */
export interface LspLocation {
  uri: string;
  range: LspRange;
}

/** LSP 范围 */
export interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

/** LSP 位置 */
export interface LspPosition {
  line: number;
  character: number;
}

/** LSP 诊断 */
export interface LspDiagnostic {
  range: LspRange;
  severity?: number;
  code?: string | number;
  message: string;
  source?: string;
  relatedInformation?: {
    location: LspLocation;
    message: string;
  }[];
}

/** 符号信息 */
export interface LspSymbolInformation {
  name: string;
  kind: number;
  location: LspLocation;
  containerName?: string;
}

/** 文档符号 */
export interface LspDocumentSymbol extends LspSymbolInformation {
  children?: LspDocumentSymbol[];
  detail?: string;
  range: LspRange;
  selectionRange: LspRange;
}

/** Hover 信息 */
export interface LspHover {
  contents: ({ language: string; value: string } | string)[];
  range?: LspRange;
}

/** 补全项 */
export interface LspCompletionItem {
  label: string;
  kind?: number;
  detail?: string;
  documentation?: string;
  sortText?: string;
  filterText?: string;
  insertText?: string;
  textEdit?: {
    range: LspRange;
    newText: string;
  };
}

/** 代码操作 */
export interface LspCodeAction {
  title: string;
  kind?: string;
  diagnostics?: LspDiagnostic[];
  edit?: {
    changes: {
      textDocument: { uri: string };
      edits: {
        range: LspRange;
        newText: string;
      }[];
    }[];
  };
  command?: {
    title: string;
    command: string;
    arguments?: unknown[];
  };
}

/** 文本编辑 */
export interface LspTextEdit {
  range: LspRange;
  newText: string;
}

/** 服务器能力 */
export interface ServerCapabilities {
  textDocumentSync?: number;
  documentSymbolProvider?: boolean;
  workspaceSymbolProvider?: boolean;
  definitionProvider?: boolean;
  referencesProvider?: boolean;
  hoverProvider?: boolean;
  completionProvider?: {
    triggerCharacters?: string[];
  };
  codeActionProvider?: boolean;
  renameProvider?: boolean;
  documentFormattingProvider?: boolean;
  documentRangeFormattingProvider?: boolean;
  signatureHelpProvider?: {
    triggerCharacters?: string[];
  };
  implementationProvider?: boolean;
  typeDefinitionProvider?: boolean;
}

// ── JSON-RPC 协议 ────────────────────────────────────────────────

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: unknown;
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

// ── LSP 参数类型 ──────────────────────────────────────────────────

/** 初始化参数 */
export interface InitializeParams {
  processId?: number | null;
  rootPath?: string;
  rootUri?: string | null;
  capabilities?: unknown;
  initializationOptions?: unknown;
}

/** 初始化结果 */
export interface InitializeResult {
  capabilities: ServerCapabilities;
}

/** 文档符号参数 */
export interface DocumentSymbolParams {
  textDocument: { uri: string };
}

/** 工作区符号参数 */
export interface WorkspaceSymbolParams {
  query: string;
}

/** 定义参数 */
export interface DefinitionParams {
  textDocument: { uri: string };
  position: LspPosition;
}

/** 引用参数 */
export interface ReferenceParams extends DefinitionParams {
  context: { includeDeclaration: boolean };
}

/** Hover 参数 */
export interface HoverParams extends DefinitionParams {}

/** 补全参数 */
export interface CompletionParams extends DefinitionParams {
  context?: {
    triggerKind?: number;
    triggerCharacter?: string;
  };
}

/** 代码操作参数 */
export interface CodeActionParams {
  textDocument: { uri: string };
  range: LspRange;
  context: {
    diagnostics: LspDiagnostic[];
  };
}

/** 重命名参数 */
export interface RenameParams {
  textDocument: { uri: string };
  position: LspPosition;
  newName: string;
}

/** 格式化参数 */
export interface DocumentFormattingParams {
  textDocument: { uri: string };
  options: {
    tabSize: number;
    insertSpaces: boolean;
  };
}

/** 签名帮助参数 */
export interface SignatureHelpParams extends DefinitionParams {}

/** 实现参数 */
export interface ImplementationParams extends DefinitionParams {}

/** 类型定义参数 */
export interface TypeDefinitionParams extends DefinitionParams {}

/** 文档诊断参数 */
export interface DocumentDiagnosticParams {
  textDocument: { uri: string };
}

/** 文档诊断报告 */
export interface DocumentDiagnosticReport {
  items: LspDiagnostic[];
}

/** DidOpen 参数 */
export interface DidOpenTextDocumentParams {
  textDocument: {
    uri: string;
    languageId: string;
    version: number;
    text: string;
  };
}

/** DidChange 参数 */
export interface DidChangeTextDocumentParams {
  textDocument: {
    uri: string;
    version: number;
  };
  contentChanges: { text: string }[];
}

/** DidClose 参数 */
export interface DidCloseTextDocumentParams {
  textDocument: { uri: string };
}

/** DidSave 参数 */
export interface DidSaveTextDocumentParams extends DidCloseTextDocumentParams {}

// ── 客户端状态 ────────────────────────────────────────────────────

/** 客户端状态 */
export type LspClientState = "stopped" | "starting" | "running" | "error";

/** 客户端选项 */
export interface LSPClientOptions {
  /** Server 启动命令 */
  command: string;
  /** 命令参数 */
  args?: string[];
  /** 工作目录 */
  cwd?: string;
  /** 环境变量 */
  env?: Record<string, string>;
  /** 初始化选项 */
  initializationOptions?: unknown;
  /** 根目录路径 */
  rootPath?: string;
  /** 根目录 URI */
  rootUri?: string | null;
  /** Client 信息 */
  clientInfo?: {
    name: string;
    version: string;
  };
  /** 请求超时(毫秒) */
  requestTimeout?: number;
}

/**
 * 解析位置结果(Location | Location[])
 */
export function parseLocationResult(result: unknown): LspLocation[] {
  if (!result) {
    return [];
  }

  if (Array.isArray(result)) {
    return (result as Record<string, unknown>[]).map((r) => parseLocation(r));
  }
  return [parseLocation(result as Record<string, unknown>)];
}

/**
 * 解析单个位置
 */
export function parseLocation(obj: Record<string, unknown>): LspLocation {
  const range = obj.range ?? {
    end: { character: 0, line: 0 },
    start: { character: 0, line: 0 },
  };
  const uri = obj.uri as string;

  return {
    range: {
      end: parsePosition((range as { end: unknown }).end),
      start: parsePosition((range as { start: unknown }).start),
    },
    uri,
  };
}

/**
 * 解析位置
 */
export function parsePosition(obj: unknown): LspPosition {
  if (typeof obj === "object" && obj !== null) {
    const pos = obj as Record<string, unknown>;
    return {
      character: (pos.character as number) ?? 0,
      line: (pos.line as number) ?? 0,
    };
  }
  return { character: 0, line: 0 };
}

/**
 * 解析诊断
 */
export function parseDiagnostic(_uri: string, obj: Record<string, unknown>): LspDiagnostic {
  const range = obj.range ?? {
    end: { character: 0, line: 0 },
    start: { character: 0, line: 0 },
  };

  return {
    code: obj.code as string | number,
    message: (obj.message as string) ?? "",
    range: {
      end: parsePosition((range as { end: unknown }).end),
      start: parsePosition((range as { start: unknown }).start),
    },
    severity: obj.severity as number,
    source: obj.source as string,
  };
}
