/**
 * IDE 集成事件 — 连接、断开、诊断、扩展安装、编辑器上下文变更。
 *
 * 职责:定义 IDE 协议层的事件契约。
 */
import { defineEvent } from "../core";

export const IdeEvents = {
  /** IDE 连接成功 */
  IDEConnected: defineEvent<{ port: number }>("ide.connected"),

  /** IDE 断开连接 */
  IDEDisconnected: defineEvent<{ reason: string }>("ide.disconnected"),

  /** IDE 诊断数据更新 */
  IDEDiagnostics: defineEvent<{
    filePath: string;
    diagnostics: {
      message: string;
      severity: string;
      line: number;
      character: number;
      source?: string;
    }[];
  }>("ide.diagnostics"),

  /** IDE 扩展安装完成 */
  IDEExtensionInstalled: defineEvent<{
    ide: string;
    success: boolean;
    error?: string;
  }>("ide.extension.installed"),

  /** 编辑器上下文变更 */
  EditorContextChanged: defineEvent<{
    activeFile?: string;
    selectedText?: string;
    cursorPosition?: { line: number; character: number };
    workspaceFolder?: string;
  }>("ide.editor.context.changed"),
} as const;
