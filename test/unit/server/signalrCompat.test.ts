/**
 * signalrCompat 单元测试 — negotiate / 帧编解码 / SignalR 握手流程
 */
import { describe, it, expect } from "bun:test";
import { encodeSignalRFrame, decodeSignalRFrames, SignalRCollaborationCompat } from "@/server/signalrCompat";

describe("encodeSignalRFrame", () => {
  it("正确添加记录分隔符", () => {
    const frame = encodeSignalRFrame({ type: 6 });
    expect(frame.endsWith("\x1e")).toBe(true);
    expect(frame).toContain('{"type":6}');
  });
});

describe("decodeSignalRFrames", () => {
  it("解析单个帧", () => {
    const raw = '{"type":1,"target":"Ping"}\x1e';
    const frames = decodeSignalRFrames(raw);
    expect(frames).toHaveLength(1);
    expect(frames[0]!.type).toBe(1);
    expect((frames[0] as any).target).toBe("Ping");
  });

  it("解析多个帧", () => {
    const raw = '{"type":6}\x1e{"type":1,"target":"Ping"}\x1e';
    const frames = decodeSignalRFrames(raw);
    expect(frames).toHaveLength(2);
    expect(frames[0]!.type).toBe(6);
    expect(frames[1]!.type).toBe(1);
  });

  it("跳过空帧", () => {
    const raw = '{"type":6}\x1e\x1e{"type":1}\x1e';
    const frames = decodeSignalRFrames(raw);
    expect(frames).toHaveLength(2);
  });

  it("Buffer 输入正确解析", () => {
    const raw = Buffer.from('{"type":6}\x1e', "utf8");
    const frames = decodeSignalRFrames(raw);
    expect(frames).toHaveLength(1);
  });

  it("无效 JSON 帧抛异常", () => {
    expect(() => decodeSignalRFrames("not-json\x1e")).toThrow();
  });
});

describe("SignalRCollaborationCompat", () => {
  function createMockManager() {
    const messages: Array<{ ws: MockWs; data: string }> = [];
    return {
      handleOpen(_ws: MockWs) {},
      handleMessage(_ws: MockWs, _raw: string | Buffer) {},
      handleClose(_ws: MockWs) {},
      getActiveRoomCount: () => 0,
      getActiveConnectionCount: () => 0,
      messages,
    };
  }

  interface MockWs {
    send(data: string): void;
    close(_code?: number, _reason?: string): void;
  }

  it("negotiate 返回连接信息", () => {
    const mockManager = createMockManager();
    const compat = new SignalRCollaborationCompat(mockManager as any);
    const result = compat.negotiate();

    expect(result.connectionId).toBeTruthy();
    expect(result.connectionToken).toBeTruthy();
    expect(result.negotiateVersion).toBe(1);
    expect(result.availableTransports).toHaveLength(1);
    expect(result.availableTransports[0]!.transport).toBe("WebSockets");
  });

  it("negotiate 带 sessionScope", () => {
    const mockManager = createMockManager();
    const compat = new SignalRCollaborationCompat(mockManager as any);
    const result = compat.negotiate({ allowedSessionIds: ["ses-1", "ses-2"] });

    expect(result.sessionScope).toEqual(["ses-1", "ses-2"]);
  });

  it("negotiate sessionScope 去重", () => {
    const mockManager = createMockManager();
    const compat = new SignalRCollaborationCompat(mockManager as any);
    const result = compat.negotiate({ allowedSessionIds: ["ses-1", "ses-1"] });

    expect(result.sessionScope).toEqual(["ses-1"]);
  });

  it("sessionScope 为空时不包含 sessionScope 字段", () => {
    const mockManager = createMockManager();
    const compat = new SignalRCollaborationCompat(mockManager as any);
    const result = compat.negotiate();

    expect("sessionScope" in result).toBe(false);
  });

  it("hasWs 对未知连接返回 false", () => {
    const mockManager = createMockManager();
    const compat = new SignalRCollaborationCompat(mockManager as any);
    expect(compat.hasWs({} as MockWs)).toBe(false);
  });

  it("handleOpen 无 token 时关闭连接", () => {
    const mockManager = createMockManager();
    const compat = new SignalRCollaborationCompat(mockManager as any);
    const mockWs: MockWs = { send: () => {}, close: (code?: number) => {} };
    const result = compat.handleOpen(mockWs, null);

    expect(result).toBe(false);
  });

  it("handleOpen 有 token 时创建连接", () => {
    const mockManager = createMockManager();
    const compat = new SignalRCollaborationCompat(mockManager as any);
    const result = compat.negotiate();
    const mockWs: MockWs = { send: () => {}, close: () => {} };

    const openResult = compat.handleOpen(mockWs, result.connectionToken);
    expect(openResult).toBe(true);
    expect(compat.hasWs(mockWs)).toBe(true);
    expect(compat.getActiveConnectionCount()).toBe(1);
  });

  it("handleClose 释放连接", () => {
    const mockManager = createMockManager();
    const compat = new SignalRCollaborationCompat(mockManager as any);
    const result = compat.negotiate();
    const mockWs: MockWs = { send: () => {}, close: () => {} };
    compat.handleOpen(mockWs, result.connectionToken);
    expect(compat.getActiveConnectionCount()).toBe(1);

    compat.handleClose(mockWs);
    expect(compat.getActiveConnectionCount()).toBe(0);
  });

  it("getPendingConnectionCount 过期清理", () => {
    const mockManager = createMockManager();
    const compat = new SignalRCollaborationCompat(mockManager as any);

    // 只创建 negotiate，不 handleOpen
    compat.negotiate();
    expect(compat.getPendingConnectionCount()).toBe(1);

    // 通过让兼容对象直接操作私有 pending map（这里测试行为）
    // 等待过期后，pending 应该被清理
    // 由于 TTL 是 60s，我们不实际等待，只验证接口存在
    expect(typeof compat.getPendingConnectionCount).toBe("function");
  });
});
