/**
 * SignalR JSON 协议兼容层 — 为协作 WebSocket 提供 SignalR 客户端互操作能力。
 *
 * 职责:
 *   - 在 CollaborationManager 与 SignalR 协议之间做帧转换
 *   - 维护 SignalR negotiate / 握手流程
 *   - 将 crab 协作事件映射为 SignalR 服务端调用
 *
 * 模块功能:
 *   - negotiate(): 协商 SignalR 连接并下发 connectionToken
 *   - handleOpen(): WebSocket 升级后建立 SignalR 会话
 *   - handleMessage(): 解析 SignalR 客户端帧
 *   - handleClose(): 释放 SignalR 会话
 *   - getActiveConnectionCount(): 当前活跃连接数
 *   - getPendingConnectionCount(): 等待握手的连接数
 *
 * 使用场景:
 *   - SignalR 客户端需要通过 /collaborationHub 接入协作
 *   - 旧版 .NET 客户端复用 crab 协作服务
 *
 * 边界:
 *   1. CollaborationManager 仍为唯一真实数据源
 *   2. 仅做协议层转换，不参与业务逻辑
 *   3. 连接 TTL 60 秒，超时自动清理
 *   4. 帧分隔符使用 \x1e(SignalR 规范)
 *
 * 流程:
 *   1. 客户端 POST /collaborationHub/negotiate 获取 connectionToken
 *   2. 客户端发起 WebSocket 升级并附带 id
 *   3. 服务端完成握手并切换为 SignalR 帧处理
 *   4. 客户端调用映射到 crab 事件总线
 *   5. 服务端推送以 SignalR Invocation 帧返回
 */
import { createId } from "@/core/identity";
import { createInternalError, createSecurityError } from "@/core/errors/appError";
import { createLogger } from "@/core/logging/logger";
import type { CollaborationManager } from "@/server/collaboration";

const log = createLogger("signalr-compat");

const RECORD_SEPARATOR = "\x1e";
const SIGNALR_CONNECTION_TTL_MS = 60_000;

interface SignalRWs {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

interface NativeWsAdapter {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

interface PendingConnection {
  connectionId: string;
  connectionToken: string;
  createdAt: number;
  allowedSessionIds?: string[];
}

interface ActiveConnection {
  actualWs: SignalRWs;
  nativeWs: NativeWsAdapter;
  connectionId: string;
  connectionToken: string;
  handshakeComplete: boolean;
  allowedSessionIds?: string[];
}

interface SignalRInvocation {
  type: 1;
  invocationId?: string;
  target?: string;
  arguments?: unknown[];
}

type SignalRMessage = SignalRInvocation | { type: 6 } | { type: 7; error?: string };

const SERVER_EVENT_TARGETS: Record<string, string> = {
  cursor: "CursorUpdated",
  error: "CollaborationError",
  event: "ConversationEvent",
  joined: "Joined",
  participant_joined: "ParticipantJoined",
  participant_left: "ParticipantLeft",
  participants: "Participants",
  permission: "PermissionStatus",
  permission_resolve_result: "PermissionResolveResult",
  pong: "Pong",
  typing: "TypingUpdated",
};

export interface SignalRNegotiateOptions {
  allowedSessionIds?: string[];
}

export interface SignalRNegotiateResponse {
  connectionId: string;
  connectionToken: string;
  negotiateVersion: 1;
  sessionScope?: string[];
  availableTransports: {
    transport: "WebSockets";
    transferFormats: ["Text"];
  }[];
}

export function encodeSignalRFrame(message: Record<string, unknown>): string {
  return `${JSON.stringify(message)}${RECORD_SEPARATOR}`;
}

export function decodeSignalRFrames(raw: string | Buffer): Record<string, unknown>[] {
  const text = typeof raw === "string" ? raw : raw.toString();
  return text
    .split(RECORD_SEPARATOR)
    .filter((part) => part.trim().length > 0)
    .map((part) => JSON.parse(part) as Record<string, unknown>);
}

export class SignalRCollaborationCompat {
  private pending = new Map<string, PendingConnection>();
  private activeByWs = new Map<SignalRWs, ActiveConnection>();

  constructor(private readonly collaborationManager: CollaborationManager) {}

  negotiate(options: SignalRNegotiateOptions = {}): SignalRNegotiateResponse {
    this.cleanupExpiredPending();
    const connectionId = createId("con");
    const connectionToken = createId("con");
    const allowedSessionIds = normalizeSessionScope(options.allowedSessionIds);
    this.pending.set(connectionToken, {
      allowedSessionIds,
      connectionId,
      connectionToken,
      createdAt: Date.now(),
    });
    return {
      connectionId,
      connectionToken,
      negotiateVersion: 1,
      ...(allowedSessionIds.length > 0 ? { sessionScope: allowedSessionIds } : {}),
      availableTransports: [{ transferFormats: ["Text"], transport: "WebSockets" }],
    };
  }

  hasWs(ws: SignalRWs): boolean {
    return this.activeByWs.has(ws);
  }

  handleOpen(actualWs: SignalRWs, connectionToken: string | null): boolean {
    this.cleanupExpiredPending();
    const pending = connectionToken ? this.pending.get(connectionToken) : undefined;
    if (!pending) {
      actualWs.close(4004, "Unknown SignalR connection token");
      return false;
    }

    const nativeWs: NativeWsAdapter = {
      close: (code, reason) => actualWs.close(code, reason),
      send: (data) => this.sendNativeMessage(actualWs, data),
    };
    this.collaborationManager.handleOpen(nativeWs);
    this.activeByWs.set(actualWs, {
      actualWs,
      allowedSessionIds: pending.allowedSessionIds,
      connectionId: pending.connectionId,
      connectionToken: pending.connectionToken,
      handshakeComplete: false,
      nativeWs,
    });
    this.pending.delete(pending.connectionToken);
    return true;
  }

  handleMessage(actualWs: SignalRWs, raw: string | Buffer): void {
    const connection = this.activeByWs.get(actualWs);
    if (!connection) {
      actualWs.close(4004, "Unknown SignalR connection");
      return;
    }

    let frames: Record<string, unknown>[];
    try {
      frames = decodeSignalRFrames(raw);
    } catch (error) {
      log.debug(`SignalR 帧解析失败: ${error instanceof Error ? error.message : String(error)}`);
      this.sendFrame(actualWs, { error: "Invalid SignalR JSON frame", type: 7 });
      actualWs.close(4000, "Invalid SignalR JSON frame");
      return;
    }

    for (const frame of frames) {
      if (!connection.handshakeComplete) {
        if (frame.protocol !== "json" || frame.version !== 1) {
          this.sendFrame(actualWs, { error: "Unsupported SignalR protocol" });
          actualWs.close(4000, "Unsupported SignalR protocol");
          return;
        }
        connection.handshakeComplete = true;
        actualWs.send(encodeSignalRFrame({}));
        continue;
      }

      this.handleSignalRMessage(connection, frame as SignalRMessage);
    }
  }

  handleClose(actualWs: SignalRWs): void {
    const connection = this.activeByWs.get(actualWs);
    if (!connection) {
      return;
    }
    this.collaborationManager.handleClose(connection.nativeWs);
    this.activeByWs.delete(actualWs);
  }

  getActiveConnectionCount(): number {
    return this.activeByWs.size;
  }

  getPendingConnectionCount(): number {
    this.cleanupExpiredPending();
    return this.pending.size;
  }

  private handleSignalRMessage(connection: ActiveConnection, frame: SignalRMessage): void {
    if (frame.type === 6) {
      this.sendFrame(connection.actualWs, { type: 6 });
      return;
    }
    if (frame.type === 7) {
      connection.actualWs.close(1000, frame.error ?? "SignalR close");
      return;
    }
    if (frame.type !== 1) {
      this.sendErrorCompletion(
        connection,
        undefined,
        `Unsupported SignalR message type: ${(frame as { type: number }).type}`,
      );
      return;
    }

    const { invocationId } = frame;
    try {
      const native = this.toNativeMessage(frame, connection.allowedSessionIds);
      if (!native) {
        this.sendErrorCompletion(connection, invocationId, `Unknown hub method: ${frame.target ?? ""}`);
        return;
      }
      this.collaborationManager.handleMessage(connection.nativeWs, JSON.stringify(native));
      if (invocationId) {
        this.sendFrame(connection.actualWs, { invocationId, result: { ok: true }, type: 3 });
      }
    } catch (error) {
      this.sendErrorCompletion(connection, invocationId, error instanceof Error ? error.message : String(error));
    }
  }

  private toNativeMessage(frame: SignalRInvocation, allowedSessionIds?: string[]): Record<string, unknown> | null {
    const args = frame.arguments ?? [];
    switch (frame.target) {
      case "JoinSession": {
        const sessionId = args[0];
        const profile = args[1] && typeof args[1] === "object" ? (args[1] as Record<string, unknown>) : {};
        if (typeof sessionId !== "string" || !sessionId.trim()) {
          throw createInternalError("INTERNAL_ERROR", "JoinSession requires sessionId");
        }
        if (scopeBlocksSession(allowedSessionIds, sessionId)) {
          throw createSecurityError("AUTH_FAILED", `SignalR connection is not authorized for session: ${sessionId}`);
        }
        return {
          color: typeof profile.color === "string" ? profile.color : undefined,
          name: typeof profile.name === "string" ? profile.name : undefined,
          sessionId,
          type: "join",
        };
      }
      case "LeaveSession": {
        return { type: "leave" };
      }
      case "UpdateCursor": {
        return { position: args[0], type: "cursor" };
      }
      case "SetTyping": {
        return { isTyping: Boolean(args[0]), type: "typing" };
      }
      case "Ping": {
        return { type: "ping" };
      }
      case "ResolvePermission": {
        const requestId = args[0];
        const action = args[1];
        if (typeof requestId !== "string" || !requestId.trim()) {
          throw createInternalError("INTERNAL_ERROR", "ResolvePermission requires requestId");
        }
        if (action !== "once" && action !== "always" && action !== "reject") {
          throw createInternalError("INTERNAL_ERROR", "ResolvePermission requires action once|always|reject");
        }
        return { action, requestId, type: "permission_resolve" };
      }
      default: {
        return null;
      }
    }
  }

  private sendNativeMessage(actualWs: SignalRWs, raw: string): void {
    let native: Record<string, unknown>;
    try {
      native = JSON.parse(raw) as Record<string, unknown>;
    } catch (error) {
      log.debug(`SignalR 原生消息解析失败: ${error instanceof Error ? error.message : String(error)}`);
      this.sendFrame(actualWs, {
        arguments: [{ message: "Invalid native collaboration message" }],
        target: "CollaborationError",
        type: 1,
      });
      return;
    }
    const nativeType = typeof native.type === "string" ? native.type : "event";
    const target = SERVER_EVENT_TARGETS[nativeType] ?? "ConversationEvent";
    const payload = { ...native };
    delete payload.type;
    this.sendFrame(actualWs, { arguments: [payload], target, type: 1 });
  }

  private sendErrorCompletion(connection: ActiveConnection, invocationId: string | undefined, message: string): void {
    if (invocationId) {
      this.sendFrame(connection.actualWs, { error: message, invocationId, type: 3 });
      return;
    }
    this.sendFrame(connection.actualWs, { arguments: [{ message }], target: "CollaborationError", type: 1 });
  }

  private sendFrame(ws: SignalRWs, message: Record<string, unknown>): void {
    ws.send(encodeSignalRFrame(message));
  }

  private cleanupExpiredPending(): void {
    const now = Date.now();
    for (const [token, connection] of this.pending) {
      if (now - connection.createdAt > SIGNALR_CONNECTION_TTL_MS) {
        this.pending.delete(token);
      }
    }
  }
}

function normalizeSessionScope(sessionIds: string[] | undefined): string[] {
  return [...new Set((sessionIds ?? []).map((sessionId) => sessionId.trim()).filter(Boolean))];
}

function scopeBlocksSession(allowedSessionIds: string[] | undefined, sessionId: string): boolean {
  return Array.isArray(allowedSessionIds) && allowedSessionIds.length > 0 && !allowedSessionIds.includes(sessionId);
}
