/**
 * VSCode 连接管理器 — WebSocket 通信
 *
 * 职责:
 *   - 自动扫描可用 VSCode 端口并连接
 *   - 接收编辑器上下文推送(活动文件/选区/光标)
 *   - 请求诊断数据
 *   - 断线自动重连(指数退避)
 *   - Diff 展示
 *
 * 模块功能:
 *   - VSCodeConnectionManager: VSCode 连接管理类
 *   - vscodeConnection: 全局连接管理器实例
 *   - connect: 连接到 VSCode 扩展
 *   - disconnect: 断开连接
 *   - sendContext: 发送编辑器上下文
 *   - requestDiagnostics: 请求诊断数据
 *   - showDiff: 显示差异
 *
 * 使用场景:
 *   - VSCode 扩展与 crab-cli 的通信
 *   - 上下文信息同步
 *   - 诊断信息获取
 *
 * 边界:
 * 1. 使用 Bun 内置 WebSocket(不依赖 ws 库)
 * 2. 断线重连使用指数退避策略
 * 3. 需要 VSCode 扩展已安装并运行
 *
 * 流程:
 * 1. 扫描可用 VSCode 端口
 * 2. 建立 WebSocket 连接
 * 3. 接收上下文推送
 * 4. 断线时自动重连
 */

import fs from "node:fs";
import { createLogger } from "@/core/logging/logger";
import { globalBus } from "@/bus";
import { IdeEvents } from "@/bus";
import { getAvailableIDEs } from "@/ide";
import type { ConnectionStatus, Diagnostic, EditorContext } from "@/ide/type";
import { createInternalError } from "@/core/errors/appError";
import { getIdeErrorMessage } from "@/ide/errors";
import { normalizePath, IDE_PORTS_FILE } from "@/ide/shared/pathUtils";

/** VSCode 扩展推送给客户端的消息结构 */
interface VscodeIncomingMessage {
  type?: string;
  workspaceFolder?: string;
  activeFile?: string;
  selectedText?: string;
  cursorPosition?: EditorContext["cursorPosition"];
  requestId?: string;
  diagnostics?: Diagnostic[];
  [key: string]: unknown;
}

const log = createLogger("ide:connection");

/** 端口信息文件路径 — 使用 shared 常量，避免重复定义 */
const PORT_INFO_PATH = IDE_PORTS_FILE;

/**
 * VSCode 连接管理器(单例模式)。
 *
 * 的核心功能:
 *   - 多端口扫描 + 工作区匹配
 *   - 编辑器上下文实时同步
 *   - 诊断请求/响应
 *   - 自动重连
 */
export class VSCodeConnection {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private readonly MAX_RECONNECT = 10;
  private readonly BASE_DELAY = 2000;
  private readonly MAX_DELAY = 30_000;
  private readonly CONNECTION_TIMEOUT = 10_000;
  private readonly CLIENT_HEARTBEAT_INTERVAL = 45_000;
  private readonly CLIENT_HEARTBEAT_TIMEOUT = 15_000;
  private port = 0;
  private status: ConnectionStatus = "disconnected";
  private editorContext: EditorContext = {};
  private listeners: ((context: EditorContext) => void)[] = [];
  private currentCwd = process.cwd();
  private _userDisconnected = false;
  private connectingPromise: Promise<void> | null = null;
  private connectionTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private lastMessageReceivedAt = 0;
  // 多工作区支持
  private connectedWorkspaceFolders = new Set<string>();
  private connectedPortHasCwdMatch = false;
  private trustContext = false;

  // ─── 连接管理 ─────────────────────────────────────────────

  /**
   * 自动扫描并连接匹配的 VSCode 实例。
   */
  async start(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) {
      return;
    }
    if (this.connectingPromise) {
      return this.connectingPromise;
    }

    const { matched } = getAvailableIDEs();
    const portsToTry = [...new Set(matched.map((ide) => ide.port))];
    const tokenMap = new Map<number, string>(
      matched.filter((ide) => ide.token).map((ide) => [ide.port, ide.token!] as [number, string]),
    );

    if (portsToTry.length === 0) {
      return Promise.reject(new Error("VSCode 未连接"));
    }

    this.setStatus("connecting");
    this._userDisconnected = false;

    this.connectingPromise = new Promise<void>((resolve, reject) => {
      let settled = false;
      let portIndex = 0;

      this.connectionTimer = setTimeout(() => {
        if (!settled) {
          settled = true;
          this.cleanup();
          this.setStatus("error");
          reject(new Error("操作超时"));
        }
      }, this.CONNECTION_TIMEOUT);

      const tryNext = () => {
        if (settled) {
          return;
        }
        if (portIndex >= portsToTry.length) {
          if (!settled) {
            settled = true;
            this.cleanup();
            this.setStatus("error");
            reject(new Error("连接失败"));
          }
          return;
        }

        const port = portsToTry[portIndex]!;
        portIndex++;

        try {
          this.ws = new WebSocket(`ws://localhost:${port}`);

          this.ws.addEventListener("open", () => {
            if (!settled) {
              settled = true;
              this.trustContext = false;
              this.reconnectAttempts = 0;
              this.port = port;
              this.refreshWorkspaceFolders();
              this.setStatus("connected");
              this.clearConnectionTimer();
              this.startClientHeartbeat();
              // 发送 ide/connect 握手携带 token
              const token = tokenMap.get(port);
              if (token) {
                try {
                  this.ws!.send(
                    JSON.stringify({
                      id: 1,
                      jsonrpc: "2.0",
                      method: "ide/connect",
                      params: { token, workspaceFolder: this.currentCwd },
                    }),
                  );
                } catch (err) {
                  log.debug("发送 ide/connect 握手失败", { error: getIdeErrorMessage(err) });
                }
              }
              resolve();
            }
          });

          this.ws.addEventListener("message", (event) => {
            try {
              const data = JSON.parse(event.data as string);
              if (this.shouldHandle(data)) {
                this.handleMessage(data);
              }
            } catch (err) {
              log.debug("解析 WebSocket 消息失败", { error: getIdeErrorMessage(err) });
            }
          });

          this.ws.addEventListener("close", () => {
            this.ws = null;
            if (settled || this.reconnectAttempts > 0) {
              this.scheduleReconnect();
            }
          });

          this.ws.addEventListener("error", () => {
            if (!settled) {
              this.ws = null;
              setTimeout(tryNext, 50);
            }
          });
        } catch {
          if (!settled) {
            setTimeout(tryNext, 50);
          }
        }
      };

      tryNext();
    });

    return this.connectingPromise.finally(() => {
      this.connectingPromise = null;
      this.clearConnectionTimer();
    });
  }

  /**
   * 连接到指定端口。
   */
  async connectToPort(targetPort: number): Promise<void> {
    this.stop();
    this._userDisconnected = false;

    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.cleanup();
        this.setStatus("error");
        reject(new Error("操作超时"));
      }, this.CONNECTION_TIMEOUT);

      try {
        this.ws = new WebSocket(`ws://localhost:${targetPort}`);
        this.setStatus("connecting");

        this.ws.addEventListener("open", () => {
          this.trustContext = false;
          this.reconnectAttempts = 0;
          this.port = targetPort;
          this.refreshWorkspaceFolders();
          this.setStatus("connected");
          this.startClientHeartbeat();
          clearTimeout(timer);
          resolve();
        });

        this.ws.addEventListener("message", (event) => {
          try {
            const data = JSON.parse(event.data as string);
            if (this.shouldHandle(data)) {
              this.handleMessage(data);
            }
          } catch (err) {
            log.debug("connectToPort 解析消息失败", { error: getIdeErrorMessage(err) });
          }
        });

        this.ws.addEventListener("close", () => {
          this.ws = null;
          this.scheduleReconnect();
        });

        this.ws.addEventListener("error", () => {
          clearTimeout(timer);
          this.cleanup();
          this.setStatus("error");
          reject(new Error(`连接端口 ${targetPort} 失败`));
        });
      } catch (error) {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error("连接失败"));
      }
    });
  }

  /** 停止连接 */
  stop(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopClientHeartbeat();
    this.clearConnectionTimer();
    this.connectingPromise = null;

    if (this.ws) {
      try {
        this.ws.close();
      } catch (err) {
        log.debug("关闭 WebSocket 连接失败", { error: getIdeErrorMessage(err) });
      }
      this.ws = null;
    }

    this.trustContext = false;
    this.connectedWorkspaceFolders.clear();
    this.connectedPortHasCwdMatch = false;
    this.reconnectAttempts = 0;
    this.setStatus("disconnected");
  }

  // ─── 状态查询 ─────────────────────────────────────────────

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  getPort(): number {
    return this.port;
  }

  getContext(): EditorContext {
    return { ...this.editorContext };
  }

  onContextUpdate(listener: (context: EditorContext) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  // ─── 请求方法 ─────────────────────────────────────────────

  /**
   * 请求指定文件的诊断数据。
   */
  async requestDiagnostics(filePath: string): Promise<Diagnostic[]> {
    return new Promise((resolve) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        resolve([]);
        return;
      }

      const requestId = Math.random().toString(36).slice(2, 9);
      let resolved = false;

      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          cleanup();
          resolve([]);
        }
      }, 2000);

      const handler = (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data as string);
          if (data.type === "diagnostics" && data.requestId === requestId) {
            if (!resolved) {
              resolved = true;
              cleanup();
              resolve(data.diagnostics || []);
            }
          }
        } catch (err) {
          log.debug("requestDiagnostics 解析响应失败", { error: getIdeErrorMessage(err) });
        }
      };

      const cleanup = () => {
        clearTimeout(timeout);
        this.ws?.removeEventListener("message", handler);
      };

      this.ws.addEventListener("message", handler);

      try {
        this.ws.send(JSON.stringify({ filePath, requestId, type: "getDiagnostics" }));
      } catch (err) {
        log.debug("requestDiagnostics 发送请求失败", { error: getIdeErrorMessage(err) });
        cleanup();
        resolve([]);
      }
    });
  }

  /**
   * 在 VSCode 中显示 diff。
   */
  async showDiff(filePath: string, originalContent: string, newContent: string, label: string): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw createInternalError("INTERNAL_ERROR", "VSCode 未连接");
    }
    this.ws.send(JSON.stringify({ filePath, label, newContent, originalContent, type: "showDiff" }));
  }

  /**
   * 关闭 diff 视图。
   */
  async closeDiff(): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw createInternalError("INTERNAL_ERROR", "VSCode 未连接");
    }
    this.ws.send(JSON.stringify({ type: "closeDiff" }));
  }

  // ─── 内部方法 ─────────────────────────────────────────────

  private setStatus(s: ConnectionStatus): void {
    const prev = this.status;
    this.status = s;
    if (prev !== s) {
      log.info(`连接状态: ${prev} → ${s}`);
      if (s === "connected") {
        globalBus.publish(IdeEvents.IDEConnected, { port: this.port });
      } else if (s === "disconnected" || s === "error") {
        globalBus.publish(IdeEvents.IDEDisconnected, { reason: s });
      }
    }
  }

  private handleMessage(data: VscodeIncomingMessage): void {
    this.lastMessageReceivedAt = Date.now();
    if (data.type === "context") {
      this.trustContext = true;
      this.editorContext = {
        activeFile: data.activeFile,
        cursorPosition: data.cursorPosition,
        selectedText: data.selectedText,
        workspaceFolder: data.workspaceFolder,
      };
      // 发布编辑器上下文变更事件
      globalBus.publish(IdeEvents.EditorContextChanged, this.editorContext);
      for (const cb of this.listeners) {
        try {
          cb(this.editorContext);
        } catch (err) {
          log.debug("编辑器上下文变更回调异常", { error: getIdeErrorMessage(err) });
        }
      }
    }
  }

  private shouldHandle(data: VscodeIncomingMessage): boolean {
    if (!data.workspaceFolder) {
      return true;
    }
    if (data.type === "context" && this.trustContext) {
      return true;
    }

    const cwd = normalizePath(this.currentCwd);
    const ws = normalizePath(data.workspaceFolder);

    if (cwd === ws || (ws.length > 1 && cwd.startsWith(`${ws}/`))) {
      return true;
    }
    if (this.connectedPortHasCwdMatch && this.connectedWorkspaceFolders.has(ws)) {
      return true;
    }

    return false;
  }

  private refreshWorkspaceFolders(): void {
    this.connectedWorkspaceFolders.clear();
    this.connectedPortHasCwdMatch = false;

    try {
      if (!fs.existsSync(PORT_INFO_PATH)) {
        return;
      }
      const info = JSON.parse(fs.readFileSync(PORT_INFO_PATH, "utf8")) as Record<string, Record<string, unknown>>;
      for (const [workspace, value] of Object.entries(info)) {
        const entryPort = typeof value === "number" ? value : (value as Record<string, unknown>)?.port;
        if (entryPort !== this.port) {
          continue;
        }
        const n = normalizePath(workspace);
        if (n) {
          this.connectedWorkspaceFolders.add(n);
        }
      }

      const cwd = normalizePath(this.currentCwd);
      for (const ws of this.connectedWorkspaceFolders) {
        if (ws.length > 1 && (cwd === ws || cwd.startsWith(`${ws}/`))) {
          this.connectedPortHasCwdMatch = true;
          break;
        }
      }
    } catch (err) {
      log.debug("读取端口文件解析工作区失败", { error: getIdeErrorMessage(err) });
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
    if (this.reconnectAttempts >= this.MAX_RECONNECT) {
      log.warn(`达到最大重连次数 (${this.MAX_RECONNECT})，停止重连`);
      return;
    }

    const delay = Math.min(this.BASE_DELAY * 1.5 ** (this.reconnectAttempts - 1), this.MAX_DELAY);
    log.info(`将在 ${Math.round(delay / 1000)}s 后重连 (第 ${this.reconnectAttempts} 次)`);

    this.reconnectTimer = setTimeout(() => {
      this.start().catch(() => {
        /* VSCode 连接重启失败不影响主流程 */
      });
    }, delay);
  }

  private cleanup(): void {
    this.connectingPromise = null;
    this.stopClientHeartbeat();
    this.clearConnectionTimer();
    if (this.ws) {
      try {
        this.ws.close();
      } catch (err) {
        log.debug("cleanup 关闭 WebSocket 失败", { error: getIdeErrorMessage(err) });
      }
      this.ws = null;
    }
  }

  private clearConnectionTimer(): void {
    if (this.connectionTimer) {
      clearTimeout(this.connectionTimer);
      this.connectionTimer = null;
    }
  }

  /** 启动客户端侧心跳检测 */
  private startClientHeartbeat(): void {
    this.stopClientHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (Date.now() - this.lastMessageReceivedAt > this.CLIENT_HEARTBEAT_TIMEOUT) {
        log.warn(`客户端心跳超时: ${Math.round((Date.now() - this.lastMessageReceivedAt) / 1000)}s 无消息，触发重连`);
        this.stopClientHeartbeat();
        try {
          if (this.ws) this.ws.close();
        } catch {
          /* ignore */
        }
        this.ws = null;
        this.setStatus("disconnected");
        this.scheduleReconnect();
      }
    }, this.CLIENT_HEARTBEAT_INTERVAL);
  }

  /** 停止客户端侧心跳检测 */
  private stopClientHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}

/** 全局 VSCode 连接实例 */
export const vscodeConnection = new VSCodeConnection();
