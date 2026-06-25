/**
 * [测试目标] Session 时间线对话框。
 *
 * 测试目标:
 *   - 验证 buildTimelineEntries / getTimelineMessageText / sessionMessageNodeId 在 timeline 视图与滚动锚点上的契约
 *
 * 测试用例:
 *   - buildTimelineEntries 只保留用户消息并按最新优先:构造混合消息列表，断言只保留 user 且倒序
 *   - getTimelineMessageText 支持 text part 回退:content 为空但 parts 含 text 时回退到 parts
 *   - sessionMessageNodeId 生成稳定 scroll anchor:断言格式
 *   - Session source wires <leader>g timeline dialog to scroll anchors:扫描源码确认 timeline 弹窗与 scroll anchor 接入
 */
import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import {
  buildTimelineEntries,
  getTimelineMessageText,
  sessionMessageNodeId,
} from "@/ui/pages/session/components/sessionTimelineDialog";
import type { ChatMessage } from "@/ui/contexts/chat";

function msg(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    content: "hello",
    id: "msg_1",
    role: "user",
    ...overrides,
  };
}

describe("Session Timeline Dialog", () => {
  test("buildTimelineEntries 只保留用户消息并按最新优先", () => {
    const entries = buildTimelineEntries([
      msg({ content: "first", id: "msg_user_1", role: "user" }),
      msg({ content: "answer", id: "msg_assistant_1", role: "assistant" }),
      msg({ content: "second", id: "msg_user_2", role: "user" }),
    ]);
    expect(entries.map((entry) => entry.id)).toEqual(["msg_user_2", "msg_user_1"]);
    expect(entries.map((entry) => entry.index)).toEqual([2, 0]);
  });

  test("getTimelineMessageText 支持 text part 回退", () => {
    expect(
      getTimelineMessageText(
        msg({
          content: "",
          parts: [{ text: "from parts", type: "text" }],
        }),
      ),
    ).toBe("from parts");
  });

  test("sessionMessageNodeId 生成稳定 scroll anchor", () => {
    expect(sessionMessageNodeId("msg_123")).toBe("session-message-msg_123");
  });

  test("Session source wires <leader>g timeline dialog to scroll anchors", () => {
    const session = fs.readFileSync(path.join(process.cwd(), "src/ui/pages/session/index.tsx"), "utf8");
    const overlays = fs.readFileSync(
      path.join(process.cwd(), "src/ui/pages/session/panels/SessionOverlays.tsx"),
      "utf8",
    );
    const messageList = fs.readFileSync(
      path.join(process.cwd(), "src/ui/pages/session/panels/MessageListView.tsx"),
      "utf8",
    );
    const slashCommands = fs.readFileSync(
      path.join(process.cwd(), "src/ui/pages/session/sessionSlashCommands.ts"),
      "utf8",
    );
    const eventHandlers = fs.readFileSync(
      path.join(process.cwd(), "src/ui/pages/session/sessionEventHandlers.ts"),
      "utf8",
    );
    expect(session).toContain("scrollChildIntoView");
    expect(session).toContain("onMoveTimeline");
    expect(slashCommands).toContain('slashCmd === "timeline"');
    expect(slashCommands).toContain("setShowTimeline(true)");
    expect(eventHandlers).toContain("setShowTimeline(true)");
    expect(overlays).toContain("SessionTimelineDialog");
    expect(overlays).toContain("onMove={props.onMoveTimeline}");
    expect(messageList).toContain("sessionMessageNodeId(msg.id)");
  });
});
