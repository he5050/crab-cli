/**
 * RuntimeEvents 跨传输层桥接测试 — P2-1 补充。
 *
 * 覆盖:
 *   - createRuntimeEvent 构造
 *   - toLegacySseEvent 全部分支（12 种事件类型）
 *   - toAcpSessionUpdate 全部分支（含 sessionId 的事件）
 *   - 无 sessionId 事件转 ACP 返回 undefined
 */
import { describe, expect, test } from "bun:test";
import { createRuntimeEvent, toLegacySseEvent, toAcpSessionUpdate } from "@/bus";

describe("createRuntimeEvent", () => {
  test("为输入添加 createdAt 时间戳", () => {
    const before = new Date();
    const event = createRuntimeEvent({ type: "session.created", sessionId: "s1" });
    const after = new Date();

    expect(event.type).toBe("session.created");
    expect(event.sessionId).toBe("s1");
    expect(new Date(event.createdAt).getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(new Date(event.createdAt).getTime()).toBeLessThanOrEqual(after.getTime());
  });

  test("保留所有原始字段", () => {
    const event = createRuntimeEvent({
      type: "tool.call.started",
      sessionId: "s1",
      toolCallId: "tc1",
      name: "bash",
      input: { command: "ls" },
    });

    expect(event.type).toBe("tool.call.started");
    expect(event.sessionId).toBe("s1");
    expect((event as any).toolCallId).toBe("tc1");
    expect((event as any).name).toBe("bash");
    expect((event as any).input).toEqual({ command: "ls" });
  });
});

describe("toLegacySseEvent — 全部分支覆盖", () => {
  test("session.created", () => {
    const event = createRuntimeEvent({ type: "session.created", sessionId: "s1" });
    const sse = toLegacySseEvent(event);
    expect(sse).toEqual({ event: "sessionCreated", data: { sessionId: "s1" } });
  });

  test("session.loaded", () => {
    const event = createRuntimeEvent({ type: "session.loaded", sessionId: "s1" });
    const sse = toLegacySseEvent(event);
    expect(sse).toEqual({ event: "sessionLoaded", data: { sessionId: "s1" } });
  });

  test("message.started", () => {
    const event = createRuntimeEvent({ type: "message.started", sessionId: "s1", messageId: "m1" });
    const sse = toLegacySseEvent(event);
    expect(sse).toEqual({ event: "messageStarted", data: { sessionId: "s1", messageId: "m1" } });
  });

  test("assistant.delta", () => {
    const event = createRuntimeEvent({ type: "assistant.delta", sessionId: "s1", messageId: "m1", text: "hello" });
    const sse = toLegacySseEvent(event);
    expect(sse).toEqual({ event: "token", data: { sessionId: "s1", messageId: "m1", token: "hello" } });
  });

  test("tool.call.started", () => {
    const event = createRuntimeEvent({
      type: "tool.call.started",
      sessionId: "s1",
      toolCallId: "tc1",
      name: "bash",
      input: { cmd: "ls" },
    });
    const sse = toLegacySseEvent(event);
    expect(sse.event).toBe("toolCall");
    expect((sse.data as any).toolName).toBe("bash");
    expect((sse.data as any).toolCallId).toBe("tc1");
    expect((sse.data as any).args).toEqual({ cmd: "ls" });
  });

  test("tool.call.delta", () => {
    const event = createRuntimeEvent({
      type: "tool.call.delta",
      sessionId: "s1",
      toolCallId: "tc1",
      delta: { output: "partial" },
    });
    const sse = toLegacySseEvent(event);
    expect(sse.event).toBe("toolCallDelta");
    expect((sse.data as any).toolCallId).toBe("tc1");
    expect((sse.data as any).delta).toEqual({ output: "partial" });
  });

  test("tool.call.completed", () => {
    const event = createRuntimeEvent({
      type: "tool.call.completed",
      sessionId: "s1",
      toolCallId: "tc1",
      name: "bash",
      result: "done",
      success: true,
    });
    const sse = toLegacySseEvent(event);
    expect(sse.event).toBe("toolResult");
    expect((sse.data as any).toolName).toBe("bash");
    expect((sse.data as any).success).toBe(true);
    expect((sse.data as any).result).toBe("done");
  });

  test("permission.requested", () => {
    const event = createRuntimeEvent({
      type: "permission.requested",
      sessionId: "s1",
      requestId: "r1",
      tool: "bash",
      patterns: ["src/**"],
    });
    const sse = toLegacySseEvent(event);
    expect(sse.event).toBe("permissionRequested");
    expect((sse.data as any).requestId).toBe("r1");
    expect((sse.data as any).patterns).toEqual(["src/**"]);
  });

  test("permission.resolved", () => {
    const event = createRuntimeEvent({
      type: "permission.resolved",
      sessionId: "s1",
      requestId: "r1",
      approved: true,
    });
    const sse = toLegacySseEvent(event);
    expect(sse).toEqual({
      event: "permissionResolved",
      data: { sessionId: "s1", requestId: "r1", approved: true },
    });
  });

  test("message.completed", () => {
    const event = createRuntimeEvent({ type: "message.completed", sessionId: "s1", messageId: "m1" });
    const sse = toLegacySseEvent(event);
    expect(sse.event).toBe("done");
    expect((sse.data as any).status).toBe("completed");
    expect((sse.data as any).messageId).toBe("m1");
  });

  test("message.cancelled", () => {
    const event = createRuntimeEvent({ type: "message.cancelled", sessionId: "s1", messageId: "m1" });
    const sse = toLegacySseEvent(event);
    expect(sse.event).toBe("cancelled");
    expect((sse.data as any).messageId).toBe("m1");
  });

  test("error 有 sessionId", () => {
    const event = createRuntimeEvent({ type: "error", sessionId: "s1", error: "oops", errorCode: "E001" });
    const sse = toLegacySseEvent(event);
    expect(sse.event).toBe("error");
    expect((sse.data as any).message).toBe("oops");
    expect((sse.data as any).errorCode).toBe("E001");
    expect((sse.data as any).sessionId).toBe("s1");
  });

  test("error 无 sessionId", () => {
    const event = createRuntimeEvent({ type: "error", error: "fatal" });
    const sse = toLegacySseEvent(event);
    expect(sse.event).toBe("error");
    expect((sse.data as any).message).toBe("fatal");
    expect((sse.data as any).sessionId).toBeUndefined();
  });
});

describe("toAcpSessionUpdate — 有 sessionId 分支覆盖", () => {
  test("session.loaded", () => {
    const event = createRuntimeEvent({ type: "session.loaded", sessionId: "s1" });
    const acp = toAcpSessionUpdate(event);
    expect(acp).toBeDefined();
    expect(acp!.sessionId).toBe("s1");
    expect((acp!.update as any).sessionUpdate).toBe("session_info_update");
  });

  test("assistant.delta", () => {
    const event = createRuntimeEvent({ type: "assistant.delta", sessionId: "s1", messageId: "m1", text: "hi" });
    const acp = toAcpSessionUpdate(event);
    expect(acp).toBeDefined();
    expect((acp!.update as any).sessionUpdate).toBe("agent_message_chunk");
    expect((acp!.update as any).content).toEqual({ text: "hi", type: "text" });
    expect((acp!.update as any).messageId).toBe("m1");
  });

  test("tool.call.started", () => {
    const event = createRuntimeEvent({
      type: "tool.call.started",
      sessionId: "s1",
      toolCallId: "tc1",
      name: "bash",
      input: "ls",
    });
    const acp = toAcpSessionUpdate(event);
    expect(acp).toBeDefined();
    expect((acp!.update as any).sessionUpdate).toBe("tool_call_update");
    expect((acp!.update as any).status).toBe("in_progress");
    expect((acp!.update as any).title).toBe("bash");
  });

  test("tool.call.delta", () => {
    const event = createRuntimeEvent({
      type: "tool.call.delta",
      sessionId: "s1",
      toolCallId: "tc1",
      delta: "partial output",
    });
    const acp = toAcpSessionUpdate(event);
    expect(acp).toBeDefined();
    expect((acp!.update as any).rawOutput).toBe("partial output");
  });

  test("tool.call.completed — success", () => {
    const event = createRuntimeEvent({
      type: "tool.call.completed",
      sessionId: "s1",
      toolCallId: "tc1",
      name: "bash",
      result: "all good",
      success: true,
    });
    const acp = toAcpSessionUpdate(event);
    expect(acp).toBeDefined();
    expect((acp!.update as any).status).toBe("completed");
    expect((acp!.update as any).rawOutput).toBe("all good");
  });

  test("tool.call.completed — failed", () => {
    const event = createRuntimeEvent({
      type: "tool.call.completed",
      sessionId: "s1",
      toolCallId: "tc1",
      name: "bash",
      result: "exit 1",
      success: false,
    });
    const acp = toAcpSessionUpdate(event);
    expect(acp).toBeDefined();
    expect((acp!.update as any).status).toBe("failed");
  });

  test("message.cancelled", () => {
    const event = createRuntimeEvent({ type: "message.cancelled", sessionId: "s1", messageId: "m1" });
    const acp = toAcpSessionUpdate(event);
    expect(acp).toBeDefined();
    expect((acp!.update as any).sessionUpdate).toBe("agent_message_chunk");
    expect((acp!.update as any).content).toEqual({ text: "Message cancelled.", type: "text" });
  });

  test("error 有 sessionId", () => {
    const event = createRuntimeEvent({ type: "error", sessionId: "s1", error: "boom", errorCode: "E1" });
    const acp = toAcpSessionUpdate(event);
    expect(acp).toBeDefined();
    expect((acp!.update as any).sessionUpdate).toBe("agent_message_chunk");
    expect((acp!.update as any).content).toEqual({ text: "boom", type: "text" });
  });
});

describe("toAcpSessionUpdate — 边界条件", () => {
  test("无 sessionId 事件返回 undefined", () => {
    const event = createRuntimeEvent({ type: "error", error: "no session" });
    expect(toAcpSessionUpdate(event)).toBeUndefined();
  });

  test("session.created 无对应 ACP 分支返回 undefined", () => {
    const event = createRuntimeEvent({ type: "session.created", sessionId: "s1" });
    expect(toAcpSessionUpdate(event)).toBeUndefined();
  });

  test("message.started 无对应 ACP 分支返回 undefined", () => {
    const event = createRuntimeEvent({ type: "message.started", sessionId: "s1", messageId: "m1" });
    expect(toAcpSessionUpdate(event)).toBeUndefined();
  });

  test("permission.requested 无对应 ACP 分支返回 undefined", () => {
    const event = createRuntimeEvent({
      type: "permission.requested",
      sessionId: "s1",
      requestId: "r1",
      tool: "bash",
    });
    expect(toAcpSessionUpdate(event)).toBeUndefined();
  });

  test("permission.resolved 无对应 ACP 分支返回 undefined", () => {
    const event = createRuntimeEvent({
      type: "permission.resolved",
      sessionId: "s1",
      requestId: "r1",
      approved: false,
    });
    expect(toAcpSessionUpdate(event)).toBeUndefined();
  });

  test("message.completed 无对应 ACP 分支返回 undefined", () => {
    const event = createRuntimeEvent({ type: "message.completed", sessionId: "s1", messageId: "m1" });
    expect(toAcpSessionUpdate(event)).toBeUndefined();
  });
});
