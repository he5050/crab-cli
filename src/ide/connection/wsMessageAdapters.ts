/**
 * IDE WebSocket 消息适配器模块 — JSON-RPC params ↔ 内部数据结构的转换。
 *
 * 职责:
 *   - 将 IDE 推送的 JSON params 转换为强类型 EditorContext / 诊断负载
 *   - 对入站消息进行基础边界校验
 *
 * 模块功能:
 *   - editorContextFromParams: 构造 EditorContext
 *   - diagnosticsFromParams: 构造 IdeDiagnosticPayload 数组
 *   - validateSimpleMessageBounds: 简单消息长度边界检查
 *   - IdeDiagnosticPayload: 诊断负载接口
 *
 * 使用场景:
 *   - wsServer 在收到 context/diagnostics 通知时调用本模块解析
 *
 * 边界:
 *   1. 仅做轻量校验(长度/类型强转)，不做复杂 schema 校验
 *   2. 字段缺失时安全降级到 undefined / 默认 severity="info"
 *   3. 不抛错；返回可空值供上游决策
 *
 * 流程:
 *   1. 上游传入 params 字典
 *   2. 适配器按字段名映射/强转
 *   3. validateSimpleMessageBounds 返回首条错误信息或 null
 */
import type { EditorContext } from "@/ide/types";

export interface IdeDiagnosticPayload {
  message: string;
  severity: string;
  line: number;
  character: number;
  source?: string;
}

export function editorContextFromParams(params: Record<string, unknown>): EditorContext {
  return {
    activeFile: params.activeFile as string | undefined,
    cursorPosition: params.cursorPosition as EditorContext["cursorPosition"],
    selectedText: params.selectedText as string | undefined,
    workspaceFolder: params.workspaceFolder as string | undefined,
  };
}

export function diagnosticsFromParams(
  diagnostics: Record<string, unknown>[] | undefined,
): IdeDiagnosticPayload[] | undefined {
  if (!diagnostics) {
    return undefined;
  }
  return diagnostics.map((diagnostic) => ({
    character: Number(diagnostic.character ?? 0),
    line: Number(diagnostic.line ?? 0),
    message: String(diagnostic.message ?? ""),
    severity: String(diagnostic.severity ?? "info"),
    source: diagnostic.source != null ? String(diagnostic.source) : undefined,
  }));
}

export function validateSimpleMessageBounds(data: Record<string, unknown>): string | null {
  const type = data.type as string;
  if (type === "context") {
    const activeFile = data.activeFile as string | undefined;
    if (activeFile && activeFile.length > 1024) {
      return "activeFile 超长，已截断";
    }
    const workspaceFolder = data.workspaceFolder as string | undefined;
    if (workspaceFolder && workspaceFolder.length > 512) {
      return "workspaceFolder 超长，已截断";
    }
    const selectedText = data.selectedText as string | undefined;
    if (selectedText && selectedText.length > 100 * 1024) {
      return "selectedText 超长，已截断";
    }
  }
  if (type === "diagnostics") {
    const filePath = data.filePath as string | undefined;
    if (filePath && filePath.length > 1024) {
      return "filePath 超长，已截断";
    }
  }
  return null;
}
