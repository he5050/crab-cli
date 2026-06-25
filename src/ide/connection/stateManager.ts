/**
 * IDE 连接状态管理器 — 聚合多客户端状态，提供统一视图
 *
 * 职责:
 *   - 跟踪所有 IDE 客户端连接状态
 *   - 聚合编辑器上下文(合并多个 IDE 的上下文)
 *   - 管理连接生命周期事件
 *   - 提供状态快照供外部查询
 *
 * 模块功能:
 *   - IDEConnectionState: 聚合后的 IDE 连接状态接口
 *   - IDEStateManager: 状态管理类
 *   - ideStateManager: 全局 IDE 状态管理器实例
 *   - init: 初始化状态管理，订阅 wsServer 事件
 *   - getState: 获取当前聚合状态的快照
 *   - getEditorContext: 获取当前编辑器上下文
 *   - onContextChange: 监听编辑器上下文变更
 *
 * 使用场景:
 *   - IDE 连接状态监控
 *   - 编辑器上下文同步
 *   - 多客户端状态聚合
 *
 * 边界:
 * 1. 依赖 wsServer 事件系统
 * 2. 上下文合并策略:取最新活跃的那个
 * 3. 不处理 IDE 连接的具体通信逻辑
 * 4. 不再发布全局事件(由 wsServer 统一负责)
 *
 * 流程:
 * 1. 初始化(init)订阅 wsServer 事件
 * 2. 客户端连接/断开时更新状态
 * 3. 上下文变更时合并并通知监听器
 */

import { createLogger } from "@/core/logging/logger";
import { type IDEClient, ideWsServer } from "./wsServer";
import { wireInteractionManager } from "./interactionManager";
import type { ConnectionStatus, EditorContext } from "@/ide/types";
import { createIdeError, toIdeLogPayload } from "@/ide/errors";

const log = createLogger("ide:state");

/** 聚合后的 IDE 连接状态 */
export interface IDEConnectionState {
  /** 是否有任何 IDE 已连接 */
  connected: boolean;
  /** 服务端状态 */
  serverStatus: ConnectionStatus;
  /** 服务端端口 */
  serverPort: number;
  /** 已连接客户端数 */
  clientCount: number;
  /** 所有已连接工作区 */
  workspaceFolders: string[];
  /** 合并后的编辑器上下文(取最新活跃的那个) */
  editorContext: EditorContext;
  /** 各客户端详情 */
  clients: {
    id: string;
    workspaceFolder?: string;
    connectedAt: number;
    lastActiveAt: number;
  }[];
}

export class IDEStateManager {
  private _editorContext: EditorContext = {};
  private _onContextChangeCallbacks: ((context: EditorContext) => void)[] = [];

  /** 初始化状态管理，订阅 wsServer 事件 */
  init(): void {
    wireInteractionManager();

    ideWsServer.on<IDEClient>("client-connected", (client) => {
      log.info(`状态更新: 客户端已连接 ${client.id}`);
    });

    ideWsServer.on<IDEClient>("client-disconnected", (client) => {
      log.info(`状态更新: 客户端已断开 ${client.id}`);
    });

    ideWsServer.on<{ clientId: string; context: EditorContext }>("context-update", ({ context }) => {
      this._editorContext = context;
      this.notifyContextChange(context);
    });
  }

  /** 获取当前聚合状态的快照 */
  getState(): IDEConnectionState {
    const clients = ideWsServer.getClients();
    const workspaceFolders = clients.map((c) => c.workspaceFolder).filter((w): w is string => Boolean(w));
    const uniqueWorkspaces = [...new Set(workspaceFolders)];

    return {
      clientCount: clients.length,
      clients: clients.map((c) => ({
        id: c.id,
        workspaceFolder: c.workspaceFolder,
        connectedAt: c.connectedAt,
        lastActiveAt: c.lastActiveAt,
      })),
      connected: clients.length > 0,
      editorContext: { ...this._editorContext },
      serverPort: ideWsServer.port,
      serverStatus: ideWsServer.status,
      workspaceFolders: uniqueWorkspaces,
    };
  }

  /** 获取当前编辑器上下文 */
  getEditorContext(): EditorContext {
    return { ...this._editorContext };
  }

  /** 监听编辑器上下文变更 */
  onContextChange(callback: (context: EditorContext) => void): () => void {
    this._onContextChangeCallbacks.push(callback);
    return () => {
      this._onContextChangeCallbacks = this._onContextChangeCallbacks.filter((cb) => cb !== callback);
    };
  }

  /** 通知上下文变更监听器 */
  private notifyContextChange(context: EditorContext): void {
    for (const cb of this._onContextChangeCallbacks) {
      try {
        cb(context);
      } catch (err) {
        const error = createIdeError(
          err,
          {
            operation: "notifyContextChange",
          },
          "callback",
        );
        log.debug("上下文变更回调异常", toIdeLogPayload(error));
      }
    }
  }
}

/** 全局 IDE 状态管理器实例 */
export const ideStateManager = new IDEStateManager();
