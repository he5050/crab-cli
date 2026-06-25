/**
 * IDE 集成模块 — 统一导出。
 *
 * 职责:
 *   - 提供 IDE 连接管理功能
 *   - 检测可用的 IDE
 *   - 安装和管理 IDE 扩展
 *   - 获取编辑器上下文信息
 *
 * 模块功能:
 *   - VSCodeConnection: VSCode 连接管理器
 *   - detectIDE: 检测 IDE
 *   - installExtension: 安装扩展
 *   - buildEditorContextPrompt: 构建编辑器上下文提示
 *   - IDEName: IDE 名称类型
 *   - IDEInfo: IDE 信息接口
 *   - EditorContext: 编辑器上下文接口
 *   - Diagnostic: 诊断信息接口
 *
 * 使用场景:
 *   - 连接 VSCode 获取编辑器信息
 *   - 检测系统安装的 IDE
 *   - 安装 crab-cli 扩展
 *   - 获取当前编辑文件上下文
 *
 * 边界:
 *   1. 目前主要支持 VSCode
 *   2. 通过 WebSocket 与 IDE 通信
 *   3. 扩展安装需要 IDE CLI 支持
 *   4. 编辑器上下文需要活跃连接
 *
 * 流程:
 *   1. 调用 detectIDE 检测可用 IDE
 *   2. 创建 VSCodeConnection 实例
 *   3. 建立 WebSocket 连接
 *   4. 获取编辑器上下文和诊断信息
 *   5. 按需安装扩展
 */

// ─── 类型 ──────────────────────────────────────────────────────
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

// ─── 错误处理 ──────────────────────────────────────────────────
export type { IdeErrorReason, IdeErrorContext } from "@/ide/errors";
export { createIdeError, getIdeErrorMessage, toIdeLogPayload } from "@/ide/errors";

// ─── IDE 检测 ─────────────────────────────────────────────────
export { detectIDE, isExtensionInstalled, getAvailableIDEs, hasMatchingIDE } from "@/ide/detection";

// ─── 扩展安装 ─────────────────────────────────────────────────
export { installExtension, isExtensionInstalledCli } from "@/ide/extension";

// ─── VSCode 连接 ──────────────────────────────────────────────
export { VSCodeConnection, vscodeConnection } from "@/ide/client";

// ─── JetBrains ────────────────────────────────────────────────
export {
  detectJetBrainsInstances,
  getJetBrainsEditorState,
  getJetBrainsDiagnostics,
  openInJetBrains,
} from "@/ide/client";
export type { JetBrainsInstance, JetBrainsDiagnostic, JetBrainsEditorState } from "@/ide/client";

// ─── 编辑器上下文 ─────────────────────────────────────────────
export {
  buildEditorContextPrompt,
  hasEditorContext,
  getEditorContextSummary,
  onEditorContextChange,
  startEditorContextWatch,
} from "@/ide/context";

// ─── 连接管理 ──────────────────────────────────────────────
export { IDEWebSocketServer, ideWsServer } from "@/ide/connection";
export type { IDEClient, SendRequestResult } from "@/ide/connection";
export { ideStateManager } from "@/ide/connection";
export type { IDEConnectionState } from "@/ide/connection";
export { getAggregatedContext, getAggregatedContextPrompt, onAggregatedContextChange } from "@/ide/connection";
export type { AggregatedContext } from "@/ide/connection";

// ─── VSIX 能力面 ──────────────────────────────────────────────
export { getVsixSurface } from "@/ide/vsix";
export type { VsixSurface, VsixCommandSurface, VsixCapabilitySurface, VsixCapabilityStatus } from "@/ide/vsix";
