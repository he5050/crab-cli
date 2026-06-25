/**
 * collaboration 单元测试 — CollaborationManager join/leave/cursor/typing/broadcast
 */
import { describe, it, expect, beforeEach } from "bun:test";
import { CollaborationManager } from "@/server/collaboration";

describe("CollaborationManager", () => {
  let manager: CollaborationManager;

  interface MockWs {
    send(data: string): void;
    close(_code?: number, _reason?: string): void;
    /** 唯一标识，用于在 sentRecords 中区分不同 ws */
    readonly id: number;
  }

  let wsCounter = 0;
  /** 每条 send 记录：哪个 ws 发了什么数据 */
  const sentRecords: Array<{ wsId: number; data: string }> = [];

  function createMockWs(): MockWs {
    const ws: MockWs = {
      id: ++wsCounter,
      send(data: string) {
        sentRecords.push({ wsId: ws.id, data });
      },
      close() {},
    };
    return ws;
  }

  /** 查询某个 ws 收到的所有已解析消息 */
  function getSentMessagesFor(ws: MockWs): Array<Record<string, unknown>> {
    return sentRecords.filter((r) => r.wsId === ws.id).map((r) => JSON.parse(r.data));
  }

  beforeEach(() => {
    manager = new CollaborationManager();
    wsCounter = 0;
    sentRecords.length = 0;
  });

  it("handleOpen 创建客户端", () => {
    const ws = createMockWs();
    const data = manager.handleOpen(ws);
    expect(data.clientId).toBeTruthy();
    expect(manager.getActiveConnectionCount()).toBe(1);
  });

  it("handleClose 移除客户端", () => {
    const ws = createMockWs();
    manager.handleOpen(ws);
    expect(manager.getActiveConnectionCount()).toBe(1);
    manager.handleClose(ws);
    expect(manager.getActiveConnectionCount()).toBe(0);
  });

  it("join 加入房间", () => {
    const ws = createMockWs();
    manager.handleOpen(ws);
    manager.handleMessage(ws, JSON.stringify({ sessionId: "room-1", type: "join" }));
    expect(manager.getParticipants("room-1")).toHaveLength(1);
    expect(manager.getActiveRoomCount()).toBe(1);
  });

  it("leave 离开房间", () => {
    const ws = createMockWs();
    manager.handleOpen(ws);
    manager.handleMessage(ws, JSON.stringify({ sessionId: "room-1", type: "join" }));
    expect(manager.getParticipants("room-1")).toHaveLength(1);
    manager.handleMessage(ws, JSON.stringify({ type: "leave" }));
    expect(manager.getParticipants("room-1")).toHaveLength(0);
  });

  it("cursor 事件广播到房间其他参与者", () => {
    const ws1 = createMockWs();
    const ws2 = createMockWs();
    const ws3 = createMockWs();
    manager.handleOpen(ws1);
    manager.handleOpen(ws2);
    manager.handleOpen(ws3);

    manager.handleMessage(ws1, JSON.stringify({ sessionId: "room-1", type: "join" }));
    manager.handleMessage(ws2, JSON.stringify({ sessionId: "room-1", type: "join" }));
    manager.handleMessage(
      ws1,
      JSON.stringify({ sessionId: "room-1", type: "cursor", position: { line: 10, character: 5 } }),
    );

    // ws2 应该收到 cursor 事件，ws1 是发送者不收到
    const ws2Msgs = getSentMessagesFor(ws2);
    const cursorMsg = ws2Msgs.find((parsed) => parsed.type === "cursor");
    expect(cursorMsg).toBeDefined();
  });

  it("typing 事件广播", () => {
    const ws1 = createMockWs();
    const ws2 = createMockWs();
    manager.handleOpen(ws1);
    manager.handleOpen(ws2);
    manager.handleMessage(ws1, JSON.stringify({ sessionId: "room-1", type: "join" }));
    manager.handleMessage(ws2, JSON.stringify({ sessionId: "room-1", type: "join" }));
    manager.handleMessage(ws1, JSON.stringify({ sessionId: "room-1", type: "typing", isTyping: true }));

    const ws2Msgs = getSentMessagesFor(ws2);
    const typingMsg = ws2Msgs.find((parsed) => parsed.type === "typing");
    expect(typingMsg).toBeDefined();
  });

  it("ping 返回 pong", () => {
    const ws = createMockWs();
    manager.handleOpen(ws);
    manager.handleMessage(ws, JSON.stringify({ type: "ping" }));

    const msgs = getSentMessagesFor(ws);
    const pongMsg = msgs.find((parsed) => parsed.type === "pong");
    expect(pongMsg).toBeDefined();
  });

  it("未知消息类型返回 error", () => {
    const ws = createMockWs();
    manager.handleOpen(ws);
    manager.handleMessage(ws, JSON.stringify({ type: "unknown_type" }));

    const msgs = getSentMessagesFor(ws);
    const errorMsg = msgs.find((parsed) => parsed.type === "error");
    expect(errorMsg).toBeDefined();
  });

  it("无效 JSON 返回 error", () => {
    const ws = createMockWs();
    manager.handleOpen(ws);
    manager.handleMessage(ws, "not-json");

    const msgs = getSentMessagesFor(ws);
    const errorMsg = msgs.find((parsed) => parsed.type === "error");
    expect(errorMsg).toBeDefined();
  });

  it("房间为空时自动删除", () => {
    const ws = createMockWs();
    manager.handleOpen(ws);
    manager.handleMessage(ws, JSON.stringify({ sessionId: "room-1", type: "join" }));
    expect(manager.getActiveRoomCount()).toBe(1);
    manager.handleMessage(ws, JSON.stringify({ type: "leave" }));
    expect(manager.getActiveRoomCount()).toBe(0);
  });

  it("destroy 清理所有连接", () => {
    const ws1 = createMockWs();
    const ws2 = createMockWs();
    manager.handleOpen(ws1);
    manager.handleOpen(ws2);
    expect(manager.getActiveConnectionCount()).toBe(2);
    manager.destroy();
    expect(manager.getActiveConnectionCount()).toBe(0);
  });
});
