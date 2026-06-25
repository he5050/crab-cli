import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { onMount } from "solid-js";
import type { AppConfigSchema } from "@/schema/config";
import { buildDerivedProviderConfig } from "../../helpers/realConfig";

let REAL_CONFIG: AppConfigSchema;
let setup: Awaited<ReturnType<typeof testRender>> | undefined;

async function settleFrame() {
  for (let i = 0; i < 10; i++) {
    await Bun.sleep(50);
    await setup?.renderOnce();
  }
}

afterEach(() => {
  if (setup) {
    setup.renderer.destroy();
    setup = undefined;
  }
  mock.restore();
});

describe("ChatProvider — Goal 自动续接", () => {
  beforeEach(async () => {
    REAL_CONFIG = await buildDerivedProviderConfig({
      model: "chat-goal-ui-model",
      providerId: "chat-goal-ui",
      requestMethod: "chat",
    });
  });

  test("UI 层会消费 goalContinuation 并追加后续 assistant 消息", async () => {
    const calls: string[] = [];
    let observedChat:
      | {
          messages: () => { content: string }[];
          loading: () => boolean;
          send: (content: string) => Promise<void>;
        }
      | undefined;
    const chatModule = await import(`@/ui/contexts/chat.tsx?case=${Date.now()}`);
    chatModule.__setChatContextDepsForTesting({
      ConversationHandler: class {
        getPermissionManager() {
          return {
            approve: () => {},
            destroy: () => {},
          };
        }
        destroy() {}
        clearHistory() {}
        setAbortSignal() {}
        async sendMessage(content: string) {
          calls.push(content);
          if (calls.length === 1) {
            return {
              goalContinuation: true,
              ok: true,
              text: "第一轮回复",
              toolRounds: 0,
            };
          }
          return {
            goalContinuation: false,
            ok: true,
            text: "第二轮回复",
            toolRounds: 0,
          };
        }
      } as any,
    });
    const { ChatProvider } = chatModule;
    const { useChat } = chatModule;

    function Harness() {
      const chat = useChat();
      observedChat = chat;
      onMount(() => {
        void chat.send("开始目标");
      });

      return <text content="goal-continuation-harness" />;
    }

    setup = await testRender(
      () => (
        <ChatProvider config={REAL_CONFIG} sessionId="ses_goal_ui_test">
          <Harness />
        </ChatProvider>
      ),
      { height: 8, width: 200 },
    );

    await settleFrame();

    const frame = setup.captureCharFrame();
    const renderedMessages =
      observedChat
        ?.messages()
        .map((m: { content: string }) => m.content)
        .join(" || ") ?? "";
    expect(calls).toEqual(["开始目标", "[系统自动续接] 继续推进当前目标。"]);
    expect(frame).toContain("goal-continuation-harness");
    expect(renderedMessages).toContain("开始目标");
    expect(renderedMessages).toContain("第一轮回复");
    expect(renderedMessages).toContain("第二轮回复");
    expect(observedChat?.loading()).toBe(false);
  });
});
