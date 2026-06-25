/**
 * IDE 模块类型入口 — 仅导出类型，不含运行时值。
 *
 * 使用方式:
 *   import type { IDEName, EditorContext, Diagnostic } from "@/ide/type"
 */

// ─── 核心类型 ──────────────────────────────────────────────────
export type {
  IDEName,
  IDEInfo,
  Diagnostic,
  DiagnosticSeverity,
  CursorPosition,
  EditorContext,
  ConnectionStatus,
  ExtensionInstallResult,
} from "@/ide/types";

// ─── 错误类型 ──────────────────────────────────────────────────
export type { IdeErrorReason, IdeErrorContext } from "@/ide/errors";

// ─── 连接类型 ──────────────────────────────────────────────────
export type { IDEClient, IDEConnectionState } from "@/ide/connection";
export type { AggregatedContext } from "@/ide/connection";
export type { InteractionRequest, InteractionResponse } from "@/ide/connection";
export type { IdeDiagnosticPayload } from "@/ide/connection";

// ─── JetBrains 类型 ────────────────────────────────────────────
export type { JetBrainsInstance, JetBrainsDiagnostic, JetBrainsEditorState } from "@/ide/client";

// ─── VSIX 类型 ─────────────────────────────────────────────────
export type { VsixSurface, VsixCommandSurface, VsixCapabilitySurface, VsixCapabilityStatus } from "@/ide/vsix";
