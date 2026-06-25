/**
 * IDE 类型定义模块 — VSCode 集成相关类型。
 *
 * 职责:
 *   - 定义 IDE 检测结果、诊断数据、编辑器上下文的类型
 *   - 定义 WebSocket 消息与连接状态类型
 *
 * 模块功能:
 *   - IDEName / IDEInfo: IDE 元信息
 *   - Diagnostic / DiagnosticSeverity: 诊断负载
 *   - EditorContext / CursorPosition: 编辑器上下文
 *   - ConnectionStatus: 连接状态
 *   - ExtensionInstallResult: 扩展安装结果
 *
 * 边界:
 *   1. 仅定义类型，不含运行时逻辑
 *   2. 坐标统一使用 0-based
 *   3. 不引用其他业务模块
 */

// ─── IDE 信息 ────────────────────────────────────────────────

/** IDE 名称 */
export type IDEName = "VSCode" | "VSCode Insiders" | "Cursor" | "unknown";

/** IDE 检测结果 */
export interface IDEInfo {
  /** IDE 名称 */
  name: IDEName;
  /** 工作区路径 */
  workspace: string;
  /** WebSocket 端口 */
  port: number;
  /** 是否匹配当前工作目录 */
  matched: boolean;
  /** 认证 token(端口文件 v2 格式) */
  token?: string;
}

// ─── 诊断数据 ────────────────────────────────────────────────

/** 诊断严重性 */
export type DiagnosticSeverity = "error" | "warning" | "info" | "hint";

/** 单条诊断信息 */
export interface Diagnostic {
  /** 诊断消息 */
  message: string;
  /** 严重性级别 */
  severity: DiagnosticSeverity;
  /** 行号(0-based) */
  line: number;
  /** 列号(0-based) */
  character: number;
  /** 诊断来源(如 "typescript", "eslint") */
  source?: string;
  /** 诊断代码 */
  code?: string | number;
}

// ─── 编辑器上下文 ────────────────────────────────────────────

/** 光标位置 */
export interface CursorPosition {
  /** 行号(0-based) */
  line: number;
  /** 列号(0-based) */
  character: number;
}

/** 编辑器上下文(由 VSCode 扩展推送) */
export interface EditorContext {
  /** 当前活动文件路径 */
  activeFile?: string;
  /** 当前选中文本 */
  selectedText?: string;
  /** 光标位置 */
  cursorPosition?: CursorPosition;
  /** 工作区文件夹路径 */
  workspaceFolder?: string;
}

// ─── 连接状态 ────────────────────────────────────────────────

/** 连接状态 */
export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

/** VSCode 扩展安装结果 */
export interface ExtensionInstallResult {
  success: boolean;
  error?: string;
  errorCode?: string;
}
