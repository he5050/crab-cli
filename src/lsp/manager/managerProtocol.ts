/**
 * LSP Manager 协议模块 — 协议类型与解析工具(path/uri 转换、LSP 数据结构解析)。
 *
 * 职责:
 *   - 定义 LSP 协议常用类型(Location / Diagnostic / Symbol / Completion / TextEdit)
 *   - 定义 JSON-RPC 2.0 消息结构(Request / Notification / Response)
 *   - 提供从原始 JSON 对象到强类型 LSP 实体的解析函数
 *   - 提供 path ↔ uri 互转
 *
 * 模块功能:
 *   - parseLocation / parseDiagnostic / parseSymbol / parseCompletionItem / parseTextEdit / parseWorkspaceEdit
 *   - pathToUri / uriToPath
 *
 * 使用场景:
 *   - manager / client 在收到 LSP 消息时统一解析
 *   - 上层(managerFeatures)组装高级语义请求
 *
 * 边界:
 *   1. 解析采用宽容策略:字段缺失/类型错误时降级为默认值，不抛错
 *   2. 不感知具体 Server；只遵循 LSP 公共类型
 *   3. JSON-RPC 2.0 错误码仅承载，不做业务翻译
 *
 * 流程:
 *   1. 收到 LSP 原始对象
 *   2. 调对应 parse* 强转
 *   3. 调用方按需再次组合
 */
/** LSP 位置 */
export interface LspLocation {
  /** 文件 URI */
  uri: string;
  /** 范围 */
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
}

/** LSP 诊断 */
export interface LspDiagnostic {
  /** 严重程度 */
  severity: "error" | "warning" | "information" | "hint";
  /** 位置 */
  location: LspLocation;
  /** 消息 */
  message: string;
  /** 源(如 tsserver、pyright) */
  source?: string;
  /** 诊断代码 */
  code?: string | number;
}

/** LSP 符号 */
export interface LspSymbol {
  /** 符号名 */
  name: string;
  /** 符号类型(function/class/variable 等) */
  kind: string;
  /** 位置 */
  location: LspLocation;
  /** 子符号 */
  children?: LspSymbol[];
}

/** LSP 代码补全项 */
export interface LspCompletionItem {
  /** 标签 */
  label: string;
  /** 类型 */
  kind?: string;
  /** 详情 */
  detail?: string;
  /** 文档 */
  documentation?: string;
  /** 插入文本 */
  insertText?: string;
}

/** LSP 文本编辑 */
export interface LspTextEdit {
  /** 范围 */
  range: LspLocation["range"];
  /** 新文本 */
  newText: string;
}

/** LSP 工作区编辑 */
export interface LspWorkspaceEdit {
  /** 文档变更 */
  changes?: Record<string, LspTextEdit[]>;
}

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

export function parseLocation(obj: Record<string, unknown>): LspLocation {
  const range = (obj.range ?? {
    end: { character: 0, line: 0 },
    start: { character: 0, line: 0 },
  }) as LspLocation["range"];

  return {
    range,
    uri: (obj.uri as string) ?? "",
  };
}

export function parseDiagnostic(uri: string, obj: Record<string, unknown>): LspDiagnostic {
  const severityMap: Record<number, LspDiagnostic["severity"]> = {
    1: "error",
    2: "warning",
    3: "information",
    4: "hint",
  };

  return {
    code: obj.code as string | number | undefined,
    location: parseLocation({ range: obj.range, uri }),
    message: (obj.message as string) ?? "",
    severity: severityMap[(obj.severity as number) ?? 1] ?? "error",
    source: obj.source as string | undefined,
  };
}

export function parseSymbol(obj: Record<string, unknown>): LspSymbol {
  const kindMap: Record<number, string> = {
    1: "file",
    10: "enum",
    11: "interface",
    12: "function",
    13: "variable",
    14: "constant",
    15: "string",
    16: "number",
    17: "boolean",
    18: "array",
    19: "object",
    2: "module",
    20: "key",
    21: "null",
    22: "enumMember",
    23: "struct",
    24: "event",
    25: "operator",
    26: "typeParameter",
    3: "namespace",
    4: "package",
    5: "class",
    6: "method",
    7: "property",
    8: "field",
    9: "constructor",
  };

  const location = obj.location
    ? parseLocation(obj.location as Record<string, unknown>)
    : {
        range: {
          end: ((obj.range as Record<string, unknown>) ?? { end: { character: 0, line: 0 } }).end as {
            line: number;
            character: number;
          },
          start: ((obj.range as Record<string, unknown>) ?? { start: { character: 0, line: 0 } }).start as {
            line: number;
            character: number;
          },
        },
        uri: "",
      };

  return {
    children: obj.children ? (obj.children as Record<string, unknown>[]).map((child) => parseSymbol(child)) : undefined,
    kind: kindMap[(obj.kind as number) ?? 0] ?? "unknown",
    location,
    name: (obj.name as string) ?? "",
  };
}

export function parseCompletionItem(obj: Record<string, unknown>): LspCompletionItem {
  const kindMap: Record<number, string> = {
    1: "text",
    10: "property",
    11: "unit",
    12: "value",
    13: "enum",
    14: "keyword",
    15: "snippet",
    16: "color",
    17: "file",
    18: "reference",
    19: "folder",
    2: "method",
    20: "enumMember",
    21: "constant",
    22: "struct",
    23: "event",
    24: "operator",
    25: "typeParameter",
    3: "function",
    4: "constructor",
    5: "field",
    6: "variable",
    7: "class",
    8: "interface",
    9: "module",
  };

  return {
    detail: (obj.detail as string) ?? undefined,
    documentation:
      typeof obj.documentation === "string"
        ? obj.documentation
        : ((obj.documentation as Record<string, unknown>)?.value as string),
    insertText: (obj.insertText as string) ?? undefined,
    kind: kindMap[(obj.kind as number) ?? 0],
    label: (obj.label as string) ?? "",
  };
}

export function parseTextEdit(obj: Record<string, unknown>): LspTextEdit {
  return {
    newText: (obj.newText as string) ?? "",
    range: parseLocation({ range: obj.range }).range,
  };
}

export function parseWorkspaceEdit(obj: Record<string, unknown>): LspWorkspaceEdit {
  const changes: Record<string, LspTextEdit[]> = {};
  const changesObj = obj.changes as Record<string, Record<string, unknown>[]> | undefined;

  if (changesObj) {
    for (const [uri, edits] of Object.entries(changesObj)) {
      changes[uri] = edits.map((edit) => parseTextEdit(edit));
    }
  }

  return { changes };
}

export function pathToUri(filePath: string, cwd = process.cwd()): string {
  const absolute = filePath.startsWith("/") ? filePath : `${cwd}/${filePath}`;
  return `file://${absolute}`;
}

export function uriToPath(uri: string): string {
  return uri.replace(/^file:\/\//, "");
}
