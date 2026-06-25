/**
 * 协作房间管理 — 支持多客户端基于 Session 实时协作。
 *
 * 职责:
 *   - 管理协作房间(以 sessionId 为标识)
 *   - 处理 WebSocket 消息路由
 *   - 广播协作事件到房间内所有参与者
 *   - 集成 EventBus 转发 AI 流式事件
 *
 * 消息协议:
 *   客户端 → 服务端:
 *     { type: "join", sessionId, name?, color? }
 *     { type: "leave" }
 *     { type: "cursor", position: { line, character } }
 *     { type: "typing", isTyping: boolean }
 *     { type: "ping" }
 *   服务端 → 客户端:
 *     { type: "joined", clientId, participants }
 *     { type: "participant_joined", participant }
 *     { type: "participant_left", clientId }
 *     { type: "participants", list }
 *     { type: "cursor", clientId, position, name? }
 *     { type: "typing", clientId, isTyping, name? }
 *     { type: "event", sessionId, event, data }
 *     { type: "pong" }
 *     { type: "error", message }
 */

import { createLogger } from "@/core/logging/logger";
import { createId } from "@/core/identity";
import { globalBus, type EventBus } from "@/bus";
import { AppEvent } from "@/bus";
import { resolveExternalPermissionRequestForSession } from "@/permission";
import type { ApprovalAction } from "@/permission";

const log = createLogger("collaboration");

export interface CollabParticipant {
  clientId: string;
  sessionId: string;
  connectedAt: number;
  lastActiveAt: number;
  name?: string;
  color?: string;
}

interface CollabRoom {
  sessionId: string;
  participants: Map<string, CollabParticipant>;
  createdAt: number;
}

export interface CollaborationManagerOptions {
  allowRemotePermissionApproval?: boolean;
}

interface CollabWsData {
  manager: CollaborationManager;
  clientId: string;
  sessionId: string | null;
  name?: string;
  color?: string;
}

export class CollaborationManager {
  private rooms = new Map<string, CollabRoom>();
  private wsMap = new Map<
    string,
    { ws: { send(data: string): void; close(code?: number, reason?: string): void }; data: CollabWsData }
  >();
  private unsubBus: (() => void)[] = [];
  private eventVersion = 0;
  private readonly eventBus: EventBus;

  constructor(
    private readonly options: CollaborationManagerOptions = {},
    eventBus: EventBus = globalBus,
  ) {
    this.eventBus = eventBus;
    this.subscribeBus();
  }

  private subscribeBus(): void {
    this.unsubBus.push(
      this.eventBus.subscribe(AppEvent.ConversationStreamToken, (evt) => {
        const sid = evt.properties.sessionId;
        if (!sid) {
          return;
        }
        this.broadcastToRoom(sid, "event", {
          data: { token: evt.properties.content },
          event: "assistant.delta",
          sessionId: sid,
        });
      }),
    );
    this.unsubBus.push(
      this.eventBus.subscribe(AppEvent.ConversationToolCall, (evt) => {
        const sid = evt.properties.sessionId;
        if (!sid) {
          return;
        }
        this.broadcastToRoom(sid, "event", {
          data: { args: evt.properties.args, callId: evt.properties.callId, tool: evt.properties.tool },
          event: "tool.call.started",
          sessionId: sid,
        });
      }),
    );
    this.unsubBus.push(
      this.eventBus.subscribe(AppEvent.ToolResult, (evt) => {
        const sid = evt.properties.sessionId;
        if (!sid) {
          return;
        }
        this.broadcastToRoom(sid, "event", {
          data: { callId: evt.properties.callId, success: evt.properties.success, tool: evt.properties.tool },
          event: "tool.call.completed",
          sessionId: sid,
        });
      }),
    );
    this.unsubBus.push(
      this.eventBus.subscribe(AppEvent.ConversationCompleted, (evt) => {
        const sid = evt.properties.sessionId;
        if (!sid) {
          return;
        }
        this.broadcastToRoom(sid, "event", {
          data: { error: evt.properties.error, ok: evt.properties.ok },
          event: "conversation.completed",
          sessionId: sid,
        });
      }),
    );
    this.unsubBus.push(
      this.eventBus.subscribe(AppEvent.PermissionAsked, (evt) => {
        const sid = evt.properties.sessionId;
        if (!sid) {
          return;
        }
        this.broadcastToRoom(sid, "permission", {
          description: evt.properties.description,
          patterns: evt.properties.patterns,
          permission: evt.properties.permission,
          remoteActionAllowed: false,
          requestId: evt.properties.id,
          riskLevel: evt.properties.riskLevel,
          sessionId: sid,
          status: "asked",
          tool: evt.properties.tool,
        });
      }),
    );
    this.unsubBus.push(
      this.eventBus.subscribe(AppEvent.PermissionStatus, (evt) => {
        const sid = evt.properties.sessionId;
        this.broadcastToRoom(sid, "permission", {
          action: evt.properties.action,
          allowed: evt.properties.allowed,
          permission: evt.properties.permission,
          remoteActionAllowed: false,
          requestId: evt.properties.id,
          sessionId: sid,
          status: evt.properties.status,
          tool: evt.properties.tool,
        });
      }),
    );
  }

  destroy(): void {
    for (const unsub of this.unsubBus) {
      unsub();
    }
    this.unsubBus = [];
    for (const [, entry] of this.wsMap) {
      try {
        entry.ws.close(1001, "Server shutting down");
      } catch (error) {
        log.debug(`关闭协作 WebSocket 失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    this.wsMap.clear();
    this.rooms.clear();
  }

  handleOpen(ws: { send(data: string): void; close(code?: number, reason?: string): void }): CollabWsData {
    const clientId = createId("col");
    const data: CollabWsData = { clientId, manager: this, sessionId: null };
    this.wsMap.set(clientId, { data, ws });
    log.info(`协作客户端已连接: ${clientId} (共 ${this.wsMap.size} 个)`);
    return data;
  }

  handleMessage(
    ws: { send(data: string): void; close(code?: number, reason?: string): void },
    raw: string | Buffer,
  ): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(typeof raw === "string" ? raw : raw.toString());
    } catch (error) {
      log.debug(`协作消息 JSON 解析失败: ${error instanceof Error ? error.message : String(error)}`);
      this.sendTo(ws, { message: "无效 JSON", type: "error" });
      return;
    }

    const entry = this.findEntryByWs(ws);
    if (!entry) {
      this.sendTo(ws, { message: "未注册的连接", type: "error" });
      return;
    }

    const { data } = entry;
    const type = msg.type as string | undefined;

    switch (type) {
      case "join": {
        const sessionId = msg.sessionId as string;
        if (!sessionId) {
          this.sendTo(ws, { message: "缺少 sessionId", type: "error" });
          return;
        }
        if (data.sessionId) {
          this.removeParticipantFromRoom(data, ws, data.sessionId === sessionId ? false : true);
        }
        data.sessionId = sessionId;
        data.name = msg.name as string | undefined;
        data.color = msg.color as string | undefined;

        const participant: CollabParticipant = {
          clientId: data.clientId,
          color: data.color,
          connectedAt: Date.now(),
          lastActiveAt: Date.now(),
          name: data.name,
          sessionId,
        };

        let room = this.rooms.get(sessionId);
        if (!room) {
          room = { createdAt: Date.now(), participants: new Map(), sessionId };
          this.rooms.set(sessionId, room);
        }
        room.participants.set(data.clientId, participant);

        log.info(`参与者加入房间: ${data.clientId} -> ${sessionId} (${room.participants.size} 人)`);

        this.sendTo(ws, {
          clientId: data.clientId,
          participants: this.getParticipantsList(sessionId),
          type: "joined",
        });

        this.broadcastToRoom(sessionId, "participant_joined", { participant }, ws);
        break;
      }
      case "leave": {
        this.handleLeave(ws);
        break;
      }
      case "cursor": {
        if (!data.sessionId) {
          return;
        }
        this.touch(data.clientId);
        this.broadcastToRoom(
          data.sessionId,
          "cursor",
          {
            clientId: data.clientId,
            conflictPolicy: "server-last-write-wins",
            name: data.name,
            position: msg.position,
            serverVersion: this.nextEventVersion(),
          },
          ws,
        );
        break;
      }
      case "typing": {
        if (!data.sessionId) {
          return;
        }
        this.touch(data.clientId);
        this.broadcastToRoom(
          data.sessionId,
          "typing",
          {
            clientId: data.clientId,
            conflictPolicy: "server-last-write-wins",
            isTyping: Boolean(msg.isTyping),
            name: data.name,
            serverVersion: this.nextEventVersion(),
          },
          ws,
        );
        break;
      }
      case "permission_resolve": {
        this.handleRemotePermissionResolve(ws, data, msg);
        break;
      }
      case "ping": {
        this.sendTo(ws, { ts: Date.now(), type: "pong" });
        break;
      }
      default: {
        this.sendTo(ws, { message: `未知消息类型: ${type}`, type: "error" });
      }
    }
  }

  handleClose(ws: { send(data: string): void; close(code?: number, reason?: string): void }): void {
    this.handleLeave(ws);
  }

  private handleLeave(ws: { send(data: string): void; close(code?: number, reason?: string): void }): void {
    const entry = this.findEntryByWs(ws);
    if (!entry) {
      return;
    }
    const { data } = entry;
    const { clientId, sessionId } = data;

    this.wsMap.delete(clientId);

    if (sessionId) {
      this.removeParticipantFromRoom(data, ws, true);
    }
  }

  getParticipants(sessionId: string): CollabParticipant[] {
    const room = this.rooms.get(sessionId);
    return room ? [...room.participants.values()] : [];
  }

  getActiveRoomCount(): number {
    return this.rooms.size;
  }

  getActiveConnectionCount(): number {
    return this.wsMap.size;
  }

  private broadcastToRoom(
    sessionId: string,
    type: string,
    data: unknown,
    excludeWs?: { send(data: string): void },
  ): void {
    const room = this.rooms.get(sessionId);
    if (!room) {
      return;
    }
    const payload = JSON.stringify({ type, ...(data as Record<string, unknown>) });
    for (const [pid, participant] of room.participants) {
      const entry = this.wsMap.get(pid);
      if (!entry || entry.ws === excludeWs) {
        continue;
      }
      try {
        entry.ws.send(payload);
        participant.lastActiveAt = Date.now();
      } catch (error) {
        log.warn(`发送失败，移除参与者: ${pid}`, {
          error: error instanceof Error ? error.message : String(error),
        });
        room.participants.delete(pid);
        this.wsMap.delete(pid);
      }
    }
  }

  private handleRemotePermissionResolve(
    ws: { send(data: string): void },
    data: CollabWsData,
    msg: Record<string, unknown>,
  ): void {
    if (!this.options.allowRemotePermissionApproval) {
      this.sendTo(ws, {
        error: "remote permission approval is disabled",
        ok: false,
        type: "permission_resolve_result",
      });
      return;
    }
    if (!data.sessionId) {
      this.sendTo(ws, {
        error: "join a session before resolving permissions",
        ok: false,
        type: "permission_resolve_result",
      });
      return;
    }
    const requestId = typeof msg.requestId === "string" ? msg.requestId : "";
    const action = normalizeRemoteApprovalAction(msg.action);
    if (!requestId || !action) {
      this.sendTo(ws, {
        error: "permission_resolve requires requestId and action",
        ok: false,
        type: "permission_resolve_result",
      });
      return;
    }
    const result = resolveExternalPermissionRequestForSession(requestId, data.sessionId, action);
    if (!result.ok) {
      this.sendTo(ws, {
        error: result.reason ?? "resolve_failed",
        ok: false,
        requestId,
        type: "permission_resolve_result",
      });
      return;
    }
    this.sendTo(ws, { action, ok: true, requestId, type: "permission_resolve_result" });
  }

  private removeParticipantFromRoom(data: CollabWsData, ws: { send(data: string): void }, notify: boolean): void {
    const { sessionId } = data;
    if (!sessionId) {
      return;
    }
    const room = this.rooms.get(sessionId);
    if (!room) {
      return;
    }
    room.participants.delete(data.clientId);
    log.info(`参与者离开房间: ${data.clientId} <- ${sessionId} (剩余 ${room.participants.size} 人)`);
    if (notify) {
      this.broadcastToRoom(sessionId, "participant_left", { clientId: data.clientId, name: data.name }, ws);
    }
    if (room.participants.size === 0) {
      this.rooms.delete(sessionId);
      log.info(`房间已关闭: ${sessionId}`);
    }
  }

  private touch(clientId: string): void {
    const entry = this.wsMap.get(clientId);
    const sessionId = entry?.data.sessionId;
    if (!sessionId) {
      return;
    }
    const participant = this.rooms.get(sessionId)?.participants.get(clientId);
    if (participant) {
      participant.lastActiveAt = Date.now();
    }
  }

  private nextEventVersion(): number {
    this.eventVersion += 1;
    return this.eventVersion;
  }

  private sendTo(ws: { send(data: string): void }, msg: Record<string, unknown>): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch (error) {
      log.debug(`协作 sendTo 失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private getParticipantsList(sessionId: string): CollabParticipant[] {
    const room = this.rooms.get(sessionId);
    return room
      ? [...room.participants.values()].map(
          (p) =>
            ({
              clientId: p.clientId,
              color: p.color,
              connectedAt: p.connectedAt,
              name: p.name,
            }) as CollabParticipant,
        )
      : [];
  }

  private findEntryByWs(ws: { send(data: string): void }): { ws: typeof ws; data: CollabWsData } | undefined {
    for (const [, entry] of this.wsMap) {
      if (entry.ws === ws) {
        return entry as { ws: typeof ws; data: CollabWsData };
      }
    }
    return;
  }
}

export const collaborationManager = new CollaborationManager();

function normalizeRemoteApprovalAction(value: unknown): ApprovalAction | null {
  return value === "once" || value === "always" || value === "reject" ? value : null;
}
