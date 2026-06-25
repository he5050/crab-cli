import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { onMount } from "solid-js";
import { eq } from "drizzle-orm";
import { globalBus } from "@bus";
import { AppEvent } from "@bus";
import { buildDerivedProviderConfig } from "../../helpers/realConfig";
import { closeDb, getDb, initDb } from "@db";
import { messages, sessions } from "@/db/schema";
import { ensureSession, getSession, getSessionMessages } from "@session";
import type { AppConfigSchema } from "@/schema/config";

let REAL_CONFIG: AppConfigSchema;
let setup: Awaited<ReturnType<typeof testRender>> | undefined;

async function settleFrame() {
  await Bun.sleep(50);
  await setup?.renderOnce();
  await Bun.sleep(50);
  await setup?.renderOnce();
}

function clearSessionTables() {
  const db = getDb();
  db.delete(messages).run();
  db.delete(sessions).run();
}

afterEach(async () => {
  await globalBus.flush();
  if (setup) {
    setup.renderer.destroy();
    setup = undefined;
  }
  mock.restore();
  clearSessionTables();
  closeDb();
});

describe("ChatProvider — session persistence", () => {
  beforeEach(async () => {
    initDb();
    clearSessionTables();
    REAL_CONFIG = await buildDerivedProviderConfig({
      model: "chat-session-ui-model",
      providerId: "chat-session-ui",
      requestMethod: "chat",
    });
  });

  test("persists session and user/tool/assistant messages into crab.db", async () => {
    const sessionId = "ses_ui_persist_test";
    const chatModule = await import(`@/ui/contexts/chat.tsx?persist=${Date.now()}`);
    chatModule.__setChatContextDepsForTesting({
      ConversationHandler: class {
        getPermissionManager() {
          return {
            approve: () => {},
            destroy: () => {},
          };
        }
        setAbortSignal() {}
        destroy() {}
        clearHistory() {}
        async sendMessage() {
          globalBus.publish(AppEvent.ConversationMessageSent, {
            content: "测试持久化",
            role: "user",
            sessionId,
          });
          globalBus.publish(AppEvent.ConversationToolCall, {
            args: {},
            callId: "call_ui_persist_1",
            sessionId,
            tool: "zread_get_trending",
          });
          globalBus.publish(
            AppEvent.ToolResult,
            {
              callId: "call_ui_persist_1",
              result: { summary: "ok" },
              success: true,
              tool: "zread_get_trending",
            },
            { throttle: false },
          );
          await globalBus.flush();
          return {
            goalContinuation: false,
            ok: true,
            text: "最终摘要",
            toolRounds: 2,
          };
        }
      } as any,
    });
    const { ChatProvider } = chatModule;
    const { useChat } = chatModule;

    function Harness() {
      const chat = useChat();
      onMount(() => {
        void chat.send("测试持久化");
      });
      return (
        <text>
          {chat
            .messages()
            .map((m: { content: string }) => m.content)
            .join(" || ")}
        </text>
      );
    }

    setup = await testRender(
      () => (
        <ChatProvider config={REAL_CONFIG} sessionId={sessionId}>
          <Harness />
        </ChatProvider>
      ),
      { height: 8, width: 200 },
    );

    await settleFrame();

    expect(getSession(sessionId)).toBeTruthy();
    const persisted = getSessionMessages(sessionId);
    expect(persisted.map((msg) => msg.role)).toEqual(["user", "assistant", "tool", "assistant"]);
    expect(persisted[0]!.parts[0]!.type).toBe("text");
    expect(persisted[1]!.parts[0]!.type).toBe("tool_use");
    expect(persisted[2]!.parts[0]!.type).toBe("tool_result");
    expect(persisted[3]!.parts[0]!.type).toBe("text");
  });

  test("hydrates existing persisted messages when reopening a session", async () => {
    const sessionId = "ses_ui_hydrate_test";
    ensureSession(sessionId, { model: REAL_CONFIG.defaultProvider.model, projectDir: process.cwd() });
    const db = getDb();
    db.insert(messages)
      .values({
        createdAt: Date.now(),
        id: "msg_hydrate_1",
        partsJson: JSON.stringify([{ content: "已保存用户消息", type: "text" }]),
        role: "user",
        sessionId,
      })
      .run();
    db.insert(messages)
      .values({
        createdAt: Date.now() + 1,
        id: "msg_hydrate_2",
        partsJson: JSON.stringify([{ content: "已保存助手回复", type: "text" }]),
        role: "assistant",
        sessionId,
      })
      .run();

    const chatModule = await import(`@/ui/contexts/chat.tsx?hydrate=${Date.now()}`);
    const handlerOptions: any[] = [];
    chatModule.__setChatContextDepsForTesting({
      ConversationHandler: class {
        constructor(_config: unknown, options?: unknown) {
          handlerOptions.push(options);
        }
        getPermissionManager() {
          return { approve: () => {}, destroy: () => {} };
        }
        setAbortSignal() {}
        destroy() {}
        clearHistory() {}
        async sendMessage() {
          return { goalContinuation: false, ok: true, text: "", toolRounds: 0 };
        }
      } as any,
    });
    const { ChatProvider } = chatModule;
    const { useChat } = chatModule;

    function Harness() {
      const chat = useChat();
      return (
        <text>
          {chat
            .messages()
            .map((m: { content: string }) => m.content)
            .join(" || ")}
        </text>
      );
    }

    setup = await testRender(
      () => (
        <ChatProvider config={REAL_CONFIG} sessionId={sessionId}>
          <Harness />
        </ChatProvider>
      ),
      { height: 8, width: 200 },
    );

    await settleFrame();

    const frame = setup.captureCharFrame();
    expect(frame).toContain("已保存用户消息");
    expect(frame).toContain("已保存助手回复");
    expect(handlerOptions[0]).toMatchObject({
      initialMessages: [
        { content: "已保存用户消息", role: "user" },
        { content: "已保存助手回复", role: "assistant" },
      ],
      sessionId,
    });
  });

  test("exposes interrupt and aborts in-flight conversation", async () => {
    const sessionId = "ses_ui_interrupt_test";
    const observedAbortSignals: AbortSignal[] = [];
    let releaseSend!: () => void;
    const sendBlocked = new Promise<void>((resolve) => {
      releaseSend = resolve;
    });

    const chatModule = await import(`@/ui/contexts/chat.tsx?interrupt=${Date.now()}`);
    chatModule.__setChatContextDepsForTesting({
      ConversationHandler: class {
        constructor(_config: unknown, options: { abortSignal?: AbortSignal }) {
          if (options.abortSignal) {
            observedAbortSignals.push(options.abortSignal);
          }
        }
        getPermissionManager() {
          return { approve: () => {}, destroy: () => {} };
        }
        setAbortSignal(signal?: AbortSignal) {
          if (signal) {
            observedAbortSignals.push(signal);
          }
        }
        destroy() {}
        clearHistory() {}
        async sendMessage() {
          await sendBlocked;
          return { error: "对话已中止", ok: false, text: "", toolRounds: 0 };
        }
      } as any,
    });
    const { ChatProvider } = chatModule;
    const { useChat } = chatModule;

    function Harness() {
      const chat = useChat();
      onMount(() => {
        void chat.send("中断测试");
        queueMicrotask(() => {
          chat.interrupt();
          releaseSend();
        });
      });
      return null;
    }

    setup = await testRender(
      () => (
        <ChatProvider config={REAL_CONFIG} sessionId={sessionId}>
          <Harness />
        </ChatProvider>
      ),
      { height: 8, width: 120 },
    );

    await settleFrame();

    expect(observedAbortSignals.length).toBeGreaterThan(0);
    expect(observedAbortSignals.some((signal) => signal.aborted)).toBe(true);
  });
});
