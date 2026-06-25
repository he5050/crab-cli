/**
 * VSCode/IDE 连接管理器模块
 *
 * 职责:
 *   - 通过 WebSocket 与 IDE 扩展通信
 *   - 管理连接生命周期(连接、重连、断开)
 *   - 提供编辑器上下文(活动文件、选中内容、光标位置)
 *   - 支持诊断信息和 diff 展示
 *
 * 模块功能:
 *   - 启动/停止 IDE 连接
 *   - 自动重连机制(指数退避)
 *   - 获取编辑器上下文(activeFile/selectedText/cursorPosition)
 *   - 请求文件诊断信息
 *   - 在 IDE 中显示 diff
 *   - 发现可用 IDE(通过端口文件)
 *
 * 使用场景:
 *   - 与 VSCode 扩展通信获取编辑器信息
 *   - 在 IDE 中展示代码修改建议
 *   - 获取当前文件的诊断信息
 *   - 多 IDE 环境下匹配正确的工作区
 *
 * 边界:
 *   1. 使用动态 import("ws") 以避免硬依赖
 *   2. 端口信息文件: ~/.crab/tmp/ide/crab-ide-ports.json，兼容旧版 /tmp/crab-cli-ports.json
 *   3. 精简实现，去除多工作区复杂逻辑
 *   4. 最大重连次数 10 次，基础延迟 2 秒
 *   5. 诊断请求超时 2 秒
 *   6. 仅支持与当前目录匹配的 IDE 工作区
 *
 * 流程:
 *   1. 读取端口文件发现可用 IDE
 *   2. 过滤与当前目录匹配的 IDE
 *   3. 尝试连接第一个匹配的 IDE
 *   4. 连接成功后监听上下文更新
 *   5. 连接断开时自动重连(指数退避)
 *   6. 提供 API 获取上下文、诊断、显示 diff
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { createInternalError } from "@/core/errors/appError";
import { logUiDebugFailure, logUiWarnFailure } from "@/ui/utils/errorLogging";

// Ws 是可选依赖，动态导入
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type WsConstructor = new (url: string) => any;

// ─── 类型 ──────────────────────────────────────────────────

export interface EditorContext {
  activeFile?: string;
  selectedText?: string;
  cursorPosition?: { line: number; character: number };
  workspaceFolder?: string;
}

export interface Diagnostic {
  message: string;
  severity: "error" | "warning" | "info" | "hint";
  line: number;
  character: number;
  source?: string;
  code?: string | number;
}

export interface IDEInfo {
  name: string;
  workspace: string;
  port: number;
  matched: boolean;
}

interface WebSocketLike {
  readyState: number;
  on(event: string, handler: (...args: unknown[]) => void): void;
  off(event: string, handler: (...args: unknown[]) => void): void;
  close(): void;
  send(data: string): void;
  removeAllListeners(event?: string): void;
}

const OPEN = 1;
const CLOSED = 3;
const DIAGNOSTICS_TIMEOUT_MS = 2000;
const LOG_SERVICE = "ui:vscode-connection";
const IDE_PORT_INFO_RELATIVE_PATH = [".crab", "tmp", "ide", "crab-ide-ports.json"] as const;
const LEGACY_IDE_PORT_INFO_FILE = "crab-cli-ports.json";

// ─── VSCodeConnectionManager ───────────────────────────────

class VSCodeConnectionManager {
  private client: WebSocketLike | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private readonly MAX_RECONNECT_ATTEMPTS = 10;
  private readonly BASE_RECONNECT_DELAY = 2000;
  private readonly MAX_RECONNECT_DELAY = 30_000;
  private readonly CONNECTION_TIMEOUT = 10_000;
  private port = 0;
  private editorContext: EditorContext = {};
  private listeners: ((context: EditorContext) => void)[] = [];
  private currentWorkingDirectory = process.cwd();
  private _userDisconnected = false;
  private connectingPromise: Promise<void> | null = null;
  private connectionTimeout: ReturnType<typeof setTimeout> | null = null;

  // ─── 连接管理 ────────────────────────────────────────

  async start(): Promise<void> {
    if (this.client?.readyState === OPEN) {
      return;
    }
    if (this.connectingPromise) {
      return this.connectingPromise;
    }

    const { matched } = this.getAvailableIDEs();
    const portsToTry = [...new Set(matched.map((ide) => ide.port))];

    if (portsToTry.length === 0) {
      return Promise.reject(new Error("未找到与当前目录匹配的 IDE"));
    }

    this.connectingPromise = new Promise((resolve, reject) => {
      let isSettled = false;
      let portIndex = 0;

      this.connectionTimeout = setTimeout(() => {
        if (!isSettled) {
          isSettled = true;
          this.cleanupConnection();
          reject(new Error("连接超时 (10秒)"));
        }
      }, this.CONNECTION_TIMEOUT);

      const tryNextPort = async () => {
        if (isSettled) {
          return;
        }
        if (portIndex >= portsToTry.length) {
          if (!isSettled) {
            isSettled = true;
            this.cleanupConnection();
            reject(new Error("无法连接到任何匹配的 IDE"));
          }
          return;
        }

        const targetPort = portsToTry[portIndex]!;
        portIndex++;

        try {
          const ws = await this.createWebSocket(targetPort);
          this.client = ws;
          this.reconnectAttempts = 0;
          this.port = targetPort;
          if (this.connectionTimeout) {
            clearTimeout(this.connectionTimeout);
          }
          this.connectionTimeout = null;
          this.connectingPromise = null;
          if (!isSettled) {
            isSettled = true;
            resolve();
          }
        } catch (error) {
          logUiDebugFailure(LOG_SERVICE, "连接 IDE 端口失败", error, {
            operation: "ui.vscodeConnection.start.tryPort",
            port: targetPort,
          });
          if (!isSettled) {
            setTimeout(() => tryNextPort(), 50);
          }
        }
      };

      tryNextPort();
    });

    return this.connectingPromise.finally(() => {
      this.connectingPromise = null;
      if (this.connectionTimeout) {
        clearTimeout(this.connectionTimeout);
        this.connectionTimeout = null;
      }
    });
  }

  private async createWebSocket(port: number): Promise<WebSocketLike> {
    try {
      const wsModule = (await import("ws")) as { default?: WsConstructor; WebSocket?: WsConstructor };
      const WsClass = wsModule.default ?? wsModule.WebSocket;
      if (!WsClass) {
        throw createInternalError("INTERNAL_ERROR", "ws 模块不可用");
      }

      return new Promise<WebSocketLike>((resolve, reject) => {
        const ws = new WsClass(`ws://localhost:${port}`) as unknown as WebSocketLike;

        const onOpen = () => {
          cleanup();
          resolve(ws);
        };

        const onError = () => {
          cleanup();
          reject(new Error(`连接 ws://localhost:${port} 失败`));
        };

        const onMessage = (message: unknown) => {
          try {
            const data = JSON.parse(String(message));
            if (data.type === "context") {
              this.editorContext = {
                activeFile: data.activeFile,
                cursorPosition: data.cursorPosition,
                selectedText: data.selectedText,
                workspaceFolder: data.workspaceFolder,
              };
              this.notifyListeners();
            }
          } catch (error) {
            logUiDebugFailure(LOG_SERVICE, "忽略无效 IDE 上下文消息", error, {
              operation: "ui.vscodeConnection.parseContextMessage",
            });
          }
        };

        const onClose = () => {
          cleanup();
          this.client = null;
          this.scheduleReconnect();
        };

        const cleanup = () => {
          ws.off("open", onOpen);
          ws.off("error", onError);
          ws.off("message", onMessage);
          ws.off("close", onClose);
        };

        ws.on("open", onOpen);
        ws.on("error", onError);
        ws.on("message", onMessage as (...args: unknown[]) => void);
        ws.on("close", onClose);
      });
    } catch (error) {
      logUiWarnFailure(LOG_SERVICE, "创建 IDE WebSocket 失败", error, {
        operation: "ui.vscodeConnection.createWebSocket",
        port,
      });
      throw createInternalError("INTERNAL_ERROR", "ws 模块不可用，请安装: npm install ws");
    }
  }

  stop(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout);
      this.connectionTimeout = null;
    }
    this.connectingPromise = null;

    if (this.client) {
      try {
        this.client.removeAllListeners();
        this.client.close();
      } catch (error) {
        logUiDebugFailure(LOG_SERVICE, "关闭 IDE 连接失败", error, {
          operation: "ui.vscodeConnection.stop",
        });
      }
      this.client = null;
    }
    this.reconnectAttempts = 0;
  }

  private cleanupConnection(): void {
    this.connectingPromise = null;
    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout);
      this.connectionTimeout = null;
    }
    if (this.client) {
      try {
        this.client.removeAllListeners();
        if (this.client.readyState !== CLOSED) {
          this.client.close();
        }
      } catch (error) {
        logUiDebugFailure(LOG_SERVICE, "清理 IDE 连接失败", error, {
          operation: "ui.vscodeConnection.cleanupConnection",
        });
      }
      this.client = null;
    }
  }

  private scheduleReconnect(): void {
    if (this._userDisconnected) {
      return;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    this.reconnectAttempts++;
    if (this.reconnectAttempts >= this.MAX_RECONNECT_ATTEMPTS) {
      return;
    }

    const delay = Math.min(this.BASE_RECONNECT_DELAY * 1.5 ** (this.reconnectAttempts - 1), this.MAX_RECONNECT_DELAY);

    this.reconnectTimer = setTimeout(() => {
      this.start().catch((error) => {
        logUiDebugFailure(LOG_SERVICE, "IDE 自动重连失败", error, {
          attempt: this.reconnectAttempts,
          operation: "ui.vscodeConnection.scheduleReconnect",
        });
      });
    }, delay);
  }

  // ─── 状态查询 ────────────────────────────────────────

  isConnected(): boolean {
    return this.client?.readyState === OPEN;
  }

  getContext(): EditorContext {
    return { ...this.editorContext };
  }

  getPort(): number {
    return this.port;
  }

  getUserDisconnected(): boolean {
    return this._userDisconnected;
  }

  setUserDisconnected(value: boolean): void {
    this._userDisconnected = value;
  }

  setCurrentWorkingDirectory(dir: string): void {
    this.currentWorkingDirectory = dir;
  }

  // ─── 事件监听 ────────────────────────────────────────

  onContextUpdate(listener: (context: EditorContext) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      listener(this.editorContext);
    }
  }

  // ─── IDE 操作 ────────────────────────────────────────

  async requestDiagnostics(filePath: string): Promise<Diagnostic[]> {
    if (!this.client || this.client.readyState !== OPEN) {
      return [];
    }
    return new Promise((resolve) => {
      const requestId = Math.random().toString(36).slice(2, 9);
      let resolved = false;

      const cleanup = () => {
        clearTimeout(timeout);
        this.client?.off("message", handler);
      };

      const finish = (diagnostics: Diagnostic[]) => {
        if (resolved) {
          return;
        }
        resolved = true;
        cleanup();
        resolve(diagnostics);
      };

      const handler = (message?: unknown) => {
        const data = parseMessagePayload(message);
        if (!data || data.type !== "diagnostics" || data.requestId !== requestId) {
          return;
        }
        finish(Array.isArray(data.diagnostics) ? (data.diagnostics as Diagnostic[]) : []);
      };

      const timeout = setTimeout(() => {
        finish([]);
      }, DIAGNOSTICS_TIMEOUT_MS);

      const { client } = this;
      if (!client) {
        finish([]);
        return;
      }
      client.on("message", handler);

      try {
        client.send(JSON.stringify({ filePath, requestId, type: "getDiagnostics" }));
      } catch (error) {
        logUiDebugFailure(LOG_SERVICE, "发送 IDE 诊断请求失败", error, {
          filePath,
          operation: "ui.vscodeConnection.requestDiagnostics",
        });
        finish([]);
      }
    });
  }

  async showDiff(filePath: string, originalContent: string, newContent: string, label: string): Promise<void> {
    if (!this.client || this.client.readyState !== OPEN) {
      throw createInternalError("INTERNAL_ERROR", "IDE 扩展未连接");
    }
    this.client.send(
      JSON.stringify({
        filePath,
        label,
        newContent,
        originalContent,
        type: "showDiff",
      }),
    );
  }

  async closeDiff(): Promise<void> {
    if (!this.client || this.client.readyState !== OPEN) {
      throw createInternalError("INTERNAL_ERROR", "IDE 扩展未连接");
    }
    this.client.send(JSON.stringify({ type: "closeDiff" }));
  }

  // ─── IDE 发现 ────────────────────────────────────────

  getAvailableIDEs(): { matched: IDEInfo[]; unmatched: IDEInfo[] } {
    const matched: IDEInfo[] = [];
    const unmatched: IDEInfo[] = [];

    try {
      const cwd = this.normalizePath(this.currentWorkingDirectory);
      const portInfoEntries = this.readPortInfoEntries();

      for (const [workspace, value] of portInfoEntries) {
        let port: number;
        let ideName: string;

        if (typeof value === "number") {
          port = value;
          ideName = "VSCode";
        } else if (
          typeof value === "object" &&
          value !== null &&
          typeof (value as Record<string, unknown>).port === "number"
        ) {
          port = (value as Record<string, unknown>).port as number;
          ideName = ((value as Record<string, unknown>).ide as string) || "IDE";
        } else {
          continue;
        }

        const normalizedWorkspace = this.normalizePath(workspace);
        const isMatch =
          normalizedWorkspace.length > 1 && (cwd === normalizedWorkspace || cwd.startsWith(`${normalizedWorkspace}/`));

        const info: IDEInfo = { matched: isMatch, name: ideName, port, workspace };
        if (isMatch) {
          matched.push(info);
        } else {
          unmatched.push(info);
        }
      }
    } catch (error) {
      logUiDebugFailure(LOG_SERVICE, "读取 IDE 端口信息失败", error, {
        operation: "ui.vscodeConnection.getAvailableIDEs",
      });
    }

    return { matched, unmatched };
  }

  hasMatchingWorkspace(): boolean {
    return this.getAvailableIDEs().matched.length > 0;
  }

  private normalizePath(filePath: string): string {
    let normalized = filePath.replace(/\\/g, "/");
    if (/^[A-Z]:/.test(normalized)) {
      normalized = normalized.charAt(0).toLowerCase() + normalized.slice(1);
    }
    return normalized;
  }

  private getPortInfoPaths(): string[] {
    return [path.join(os.homedir(), ...IDE_PORT_INFO_RELATIVE_PATH), path.join(os.tmpdir(), LEGACY_IDE_PORT_INFO_FILE)];
  }

  private readPortInfoEntries(): [string, unknown][] {
    const seen = new Set<string>();
    const entries: [string, unknown][] = [];

    for (const portInfoPath of this.getPortInfoPaths()) {
      if (!fs.existsSync(portInfoPath)) {
        continue;
      }
      const parsed = JSON.parse(fs.readFileSync(portInfoPath, "utf8"));
      if (!parsed || typeof parsed !== "object") {
        continue;
      }

      for (const entry of Object.entries(parsed) as [string, unknown][]) {
        if (seen.has(entry[0])) {
          continue;
        }
        seen.add(entry[0]);
        entries.push(entry);
      }
    }

    return entries;
  }
}

// ─── 单例导出 ──────────────────────────────────────────────

export const vscodeConnection = new VSCodeConnectionManager();

function parseMessagePayload(message?: unknown): Record<string, unknown> | null {
  if (message == null) {
    return null;
  }
  try {
    if (typeof message === "string") {
      return JSON.parse(message) as Record<string, unknown>;
    }
    if (typeof message === "object") {
      if ("data" in (message as Record<string, unknown>)) {
        const { data } = message as Record<string, unknown>;
        if (typeof data === "string") {
          return JSON.parse(data) as Record<string, unknown>;
        }
        if (typeof data === "object" && data !== null) {
          return data as Record<string, unknown>;
        }
      }
      return message as Record<string, unknown>;
    }
  } catch (error) {
    logUiDebugFailure(LOG_SERVICE, "解析 IDE 消息失败", error, {
      operation: "ui.vscodeConnection.parseMessagePayload",
    });
    return null;
  }
  return null;
}
