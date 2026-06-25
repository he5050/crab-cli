/**
 * AppEvent 载荷契约矩阵 — P3 补充。
 *
 * 遍历 AppEvent 全部事件,用最小合法 payload 调用 publish,
 * 断言不抛错(类型层缺失由 TS 编译保证,运行时仅校验 publish 路径)。
 */
import { describe, expect, test } from "bun:test";
import { EventBus } from "@/bus";
import { AppEvent } from "@/bus";
import { validateAllAppEventNames } from "@/bus";
import { validateCriticalAppEventPayloadShapes } from "@/bus";

/**
 * 给定事件定义,推断最小合法 payload。
 * 按 AppEvent.type 精确匹配,返回符合其类型契约的最小结构。
 */
function minimalPayload(evt: { type: string }): unknown {
  // Record<string, never> 事件 — 空对象即可
  if (
    evt.type === "command.palette.show" ||
    evt.type === "theme.picker.show" ||
    evt.type === "model.picker.show" ||
    evt.type === "status.dialog.show" ||
    evt.type === "leader.key.show" ||
    evt.type === "leader.key.hide" ||
    evt.type === "session.list.show" ||
    evt.type === "session.sidebar.toggle" ||
    evt.type === "session.toggle.conceal" ||
    evt.type === "session.redo.requested" ||
    evt.type === "session.undo.requested" ||
    evt.type === "session.timeline.show" ||
    evt.type === "role.picker.show" ||
    evt.type === "agent.picker.show" ||
    evt.type === "team.panel.show" ||
    evt.type === "task.panel.show" ||
    evt.type === "skill.picker.show" ||
    evt.type === "skill.creation.show" ||
    evt.type === "skill.list.show" ||
    evt.type === "profile.panel.show" ||
    evt.type === "clipboard.copy.last"
  ) {
    return {};
  }

  switch (evt.type) {
    // ─── LifecycleEvents ───────────────────────────────────
    case "app.started":
      return { pid: 1, version: "1.0.0" };
    case "app.log":
      return { level: "info", message: "test" };
    case "config.updated":
      return { config: {} };
    case "command.palette.show":
      return { query: "" };
    case "toast.show":
      return { message: "test", variant: "info" };
    case "resource.update":
      return { cpuPercent: 10, memoryMB: 256, uptime: 0 };
    case "theme.changed":
      return { mode: "dark" };

    // ─── SessionEvents ────────────────────────────────────
    case "home.prompt.submit":
      return { message: "hi", sessionId: "s1" };
    case "session.created":
      return { sessionId: "s1" };
    case "session.list.show":
      return {};
    case "session.quick.switch.requested":
      return { slot: 1 };
    case "session.redo.requested":
      return {};
    case "session.shared":
      return { format: "md", path: "/tmp/f", sessionId: "s1" };
    case "session.sidebar.toggle":
      return {};
    case "session.status.changed":
      return { previousStatus: "idle", reason: undefined, sessionId: "s1", status: "busy" };
    case "session.status.update.requested":
      return { reason: undefined, sessionId: "s1", status: "busy" };
    case "session.summarized":
      return { charCount: 100, messageCount: 5, sessionId: "s1" };
    case "session.switched":
      return { sessionId: "s1" };
    case "session.toggle.conceal":
      return {};
    case "session.undo.requested":
      return {};
    case "summary.generated":
      return { requestId: "r1", result: {} };
    case "summary.requested":
      return { messages: [], requestId: "r1", sessionId: "s1" };
    case "session.timeline.show":
      return {};

    // ─── ToolEvents ────────────────────────────────────────
    case "tool.call":
      return { args: null, callId: "c1", tool: "bash" };
    case "tool.result":
      return { callId: "c1", result: null, success: true, tool: "bash" };
    case "tool.timeout":
      return { sessionId: "s1", timeoutMs: 30000, toolName: "bash" };

    // ─── PermissionEvents ─────────────────────────────────
    case "permission.asked":
      return { id: "p1", permission: "read", tool: "bash" };
    case "permission.resolved":
      return { action: "once", allowed: true, id: "p1" };
    case "permission.status":
      return {
        action: "once",
        allowed: true,
        id: "p1",
        permission: "read",
        sessionId: "s1",
        status: "resolved",
        tool: "bash",
      };

    // ─── UserInputEvents ──────────────────────────────────
    case "user.input.requested":
      return { multiSelect: false, question: "q?", requestId: "r1" };
    case "user.input":
      return { requestId: "r1" };

    // ─── ChatEvents ───────────────────────────────────────
    case "chat.chunk":
      return { chunk: "hi" };
    case "chat.reasoning":
      return { chunk: "think" };
    case "ai.provider.status":
      return { method: "chat", model: "gpt-4", provider: "openai", status: "success" };
    case "ai.llm.retry":
      return { fallbackFrom: "chat", fallbackTo: "responses", reason: "timeout", sessionId: "s1" };

    // ─── ConversationEvents ───────────────────────────────
    case "conversation.message.sent":
      return { content: "hi", role: "user" };
    case "conversation.stream.token":
      return { content: "token", tokenCount: 1 };
    case "conversation.tool.call":
      return { args: null, callId: "c1", tool: "bash" };
    case "conversation.completed":
      return { durationMs: 0, ok: true, textLength: 0, toolRounds: 0 };
    case "conversation.aborted":
      return {};

    // ─── CompressEvents ───────────────────────────────────
    case "compress.started":
      return { percentage: 0, tokenCount: 1000 };
    case "compress.progress":
      return { progress: 50, step: "compressing" };
    case "compress.completed":
      return { compressionRatio: "0.5", method: "ai-summary", tokensAfter: 500, tokensBefore: 1000 };
    case "compress.failed":
      return { error: "err", method: "ai-summary" };
    case "compress.retrying":
      return { attempt: 1, error: "err", maxRetries: 3 };

    // ─── McpEvents ────────────────────────────────────────
    case "mcp.status.updated":
      return { builtinGroups: [], servers: [] };
    case "mcp.tools.list.changed":
      return { added: [], removed: [], serverName: "s1", toolCount: 5 };

    // ─── IdeEvents ───────────────────────────────────────
    case "ide.connected":
      return { port: 8080 };
    case "ide.disconnected":
      return { reason: "timeout" };
    case "ide.diagnostics":
      return { diagnostics: [], filePath: "/tmp/f.ts" };
    case "ide.extension.installed":
      return { ide: "vscode", success: true };
    case "ide.editor.context.changed":
      return { activeFile: "/tmp/f.ts" };

    // ─── AgentEvents ──────────────────────────────────────
    case "agent.selected":
      return { agentName: "code" };
    case "agent.status.changed":
      return { agentName: "code", previousStatus: "idle", status: "running" };
    case "agent.subagent.started":
      return { parentAgent: "main", subagentName: "sub1", taskId: "t1" };
    case "agent.subagent.completed":
      return { parentAgent: "main", subagentName: "sub1", success: true, taskId: "t1" };
    case "agent.picker.show":
      return {};
    case "agent.recovery.detected":
      return { sessions: [] };

    // ─── RoleEvents ───────────────────────────────────────
    case "role.changed":
      return { previousRoleId: null, roleId: "r1", roleName: "Coder" };
    case "role.picker.show":
      return {};

    // ─── TeamEvents ───────────────────────────────────────
    case "team.mate.spawned":
      return { name: "mate1", role: "reviewer", teammateId: "tm1", task: "review" };
    case "team.mate.status.changed":
      return { name: "mate1", newStatus: "running", oldStatus: "idle", teammateId: "tm1" };
    case "team.mate.message":
      return { from: "mate1", message: "hi", teammateId: "tm1" };
    case "team.panel.show":
      return {};

    // ─── TaskEvents ────────────────────────────────────────
    case "task.created":
      return { id: "t1", prompt: "do something" };
    case "task.status.changed":
      return { id: "t1", status: "running" };
    case "goal.status.changed":
      return { id: "g1", sessionId: "s1", status: "running" };
    case "task.panel.show":
      return {};

    // ─── SkillEvents ─────────────────────────────────────
    case "skill.executed":
      return { ok: true, promptLength: 100, skillName: "search" };
    case "skill.picker.show":
      return {};
    case "skill.creation.show":
      return {};
    case "skill.list.show":
      return {};
    case "profile.panel.show":
      return {};

    // ─── SnapshotEvents ───────────────────────────────────
    case "snapshot.created":
      return { id: "sn1", label: "checkpoint" };
    case "snapshot.restored":
      return { id: "sn1", label: "checkpoint" };

    // ─── LoopEvents ───────────────────────────────────────
    case "loop.executed":
      return { loopId: "l1", runCount: 1, status: "success" };
    case "clipboard.copy.last":
      return {};

    // ─── ResearchEvents ──────────────────────────────────
    case "btw.stream.chunk":
      return { chunk: "hi", done: false };
    case "todo.sync":
      return { items: [] };
    case "deep-research.progress":
      return { action: "planning", message: "starting", round: 1, totalRounds: 5, topic: "AI" };

    // ─── CleanupEvents ────────────────────────────────────
    case "cleanup.requested":
      return { phase: "startup", timestamp: Date.now() };
    case "cleanup.completed":
      return { filesRemoved: 0, phase: "startup", provider: "tmp" };

    // ─── HookEvents ───────────────────────────────────────
    case "hook.executed":
      return {
        decision: "allow",
        duration: 10,
        error: undefined,
        event: "pre-tool",
        hookId: "h1",
        hookName: "validate",
        success: true,
      };

    default:
      return {};
  }
}

describe("AppEvent — 载荷矩阵", () => {
  const bus = new EventBus();

  test("全部事件都能以最小 payload 发布", () => {
    const eventEntries = Object.entries(AppEvent);
    expect(eventEntries.length).toBeGreaterThan(50); // sanity check

    for (const [name, evt] of eventEntries) {
      const payload = minimalPayload(evt as { type: string });
      // publish 不应抛错
      expect(
        () => {
          bus.publish(evt as any, payload as any);
        },
        `publish ${name} (${(evt as any).type}) 应不抛错`,
      ).not.toThrow();
    }
  });

  test("事件 type 字符串无重复", () => {
    const types = Object.values(AppEvent).map((e) => e.type);
    const unique = new Set(types);
    expect(unique.size).toBe(types.length);
  });

  test("事件常量名与 type 不重复", () => {
    const names = Object.keys(AppEvent);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });

  test("特殊形状事件 — 空 Record payload 可发", () => {
    // 这些事件类型是 Record<string, never>,空对象应合法
    const emptyPayloadEvents = [
      AppEvent.CommandPaletteShow,
      AppEvent.TaskPanelShow,
      AppEvent.RolePickerShow,
      AppEvent.AgentPickerShow,
      AppEvent.SkillPickerShow,
      AppEvent.SkillCreationShow,
      AppEvent.SkillListShow,
      AppEvent.ThemePickerShow,
      AppEvent.ModelPickerShow,
      AppEvent.StatusDialogShow,
      AppEvent.LeaderKeyShow,
      AppEvent.LeaderKeyHide,
      AppEvent.ProfilePanelShow,
      AppEvent.TeamPanelShow,
      AppEvent.SessionListShow,
      AppEvent.SessionSidebarToggle,
      AppEvent.SessionToggleConceal,
      AppEvent.SessionRedoRequested,
      AppEvent.SessionUndoRequested,
      AppEvent.TimelineShow,
      AppEvent.CopyLastMessage,
    ];
    for (const evt of emptyPayloadEvents) {
      expect(() => bus.publish(evt, {} as any)).not.toThrow();
    }
  });

  test("AppEvent 聚合事件在契约测试中通过全量命名校验", () => {
    expect(validateAllAppEventNames(AppEvent)).toEqual([]);
  });

  test("关键事件 payload 能通过真实 shape 校验", () => {
    const issues = validateCriticalAppEventPayloadShapes([
      {
        eventName: "ConversationStreamToken",
        payload: { content: "token", sessionId: "s1", tokenCount: 5 },
      },
      {
        eventName: "PermissionAsked",
        payload: { id: "p1", permission: "filesystem-read", sessionId: "s1", tool: "filesystem-read" },
      },
      {
        eventName: "ToolResult",
        payload: { callId: "c1", result: { ok: true }, sessionId: "s1", success: true, tool: "bash" },
      },
      {
        eventName: "SessionStatusChanged",
        payload: { sessionId: "s1", status: "busy", previousStatus: "idle" },
      },
      {
        eventName: "ConversationCompleted",
        payload: { ok: true, toolRounds: 2, textLength: 100, durationMs: 5000 },
      },
      {
        eventName: "McpStatusUpdated",
        payload: { servers: [{ name: "s1" }], builtinGroups: [] },
      },
      {
        eventName: "GoalStatusChanged",
        payload: { id: "g1", sessionId: "s1", status: "running" },
      },
    ]);

    expect(issues).toEqual([]);
  });

  bus.destroy();
});
