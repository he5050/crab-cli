import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { globalBus } from "@bus";
import { AppEvent } from "@bus";
import { ThemeProvider } from "@/ui/contexts/theme";
import type { AppConfigSchema } from "@/schema/config";
import { buildDerivedProviderConfig } from "../../helpers/realConfig";

let REAL_CONFIG: AppConfigSchema;
let setup: Awaited<ReturnType<typeof testRender>> | undefined;
const sendCalls: string[] = [];

async function settle() {
  await Bun.sleep(30);
  await setup?.renderOnce();
  await Bun.sleep(30);
  await setup?.renderOnce();
}

afterEach(() => {
  if (setup) {
    setup.renderer.destroy();
    setup = undefined;
  }
  sendCalls.length = 0;
  mock.restore();
});

describe("Home Prompt -> Session", () => {
  beforeEach(async () => {
    REAL_CONFIG = await buildDerivedProviderConfig({
      model: "home-prompt-model",
      providerId: "home-prompt-ui",
      requestMethod: "chat",
    });
  });

  test("Session 会消费 HomePromptSubmit 并发送首条消息", async () => {
    mock.module("@ui/contexts/chat", () => {
      const useChat = () => ({
        agentInfo: () => ({ label: "General Agent" }),
        agentName: () => "general",
        canRedo: () => false,
        canUndo: () => false,
        clear: () => {},
        getConversationHistory: () => [],
        loading: () => false,
        messages: () => [],
        mode: () => "chat",
        redo: () => false,
        send: (content: string) => {
          sendCalls.push(content);
          return Promise.resolve();
        },
        streamingReasoning: () => "",
        streamingText: () => "",
        switchAgent: () => true,
        undo: () => false,
        yoloOverlay: () => false,
      });
      const ChatProvider = (props: any) => props.children;
      return { ChatProvider, useChat };
    });

    mock.module("@ui/hooks/use-lsp-diagnostics", () => ({
      useLspDiagnostics: () => ({ diagnostics: () => [] }),
    }));

    const passthrough = (name: string) => (props: any) => (
      <text>
        {name}
        {props?.children}
      </text>
    );
    mock.module("@ui/pages/session/components/messages", () => ({
      MessageItem: passthrough("msg"),
      StreamingOutput: passthrough("stream"),
    }));
    mock.module("@ui/pages/session/components/sidebar", () => ({
      SidebarPanel: passthrough("sidebar"),
    }));
    mock.module("@ui/pages/session/footer", () => ({
      SessionFooter: passthrough("footer"),
    }));
    mock.module("@ui/pages/session/components/prompt-input", () => ({
      PromptInput: passthrough("prompt"),
    }));
    mock.module("@ui/components/command-palette", () => ({ CommandPalette: passthrough("palette") }));
    mock.module("@ui/components/agent-picker", () => ({ AgentPicker: passthrough("agent") }));
    mock.module("@ui/components/role-picker", () => ({ RolePicker: passthrough("role") }));
    mock.module("@ui/components/btw-overlay", () => ({ BtwOverlay: passthrough("btw") }));
    mock.module("@ui/components/skill-picker", () => ({ SkillPicker: passthrough("skill-picker") }));
    mock.module("@ui/components/skill-creation-panel", () => ({ SkillCreationPanel: passthrough("skill-create") }));
    mock.module("@ui/components/skill-list-panel", () => ({ SkillListPanel: passthrough("skill-list") }));
    mock.module("@ui/components/team-panel", () => ({ TeamPanel: passthrough("team") }));
    mock.module("@ui/components/task-panel", () => ({ TaskPanel: passthrough("task") }));
    mock.module("@agent", () => ({
      getActiveAgent: () => ({ label: "General Agent", mode: "all", name: "general" }),
      getActiveAgentName: () => "general",
      getAgentModel: () => ({ model: "home-prompt-model", provider: "home-prompt-ui" }),
      getAgentStatus: () => "idle",
      initBuiltinAgents: () => {},
      listPrimaryAgents: () => [],
      resolveToolSubAgent: () =>
        Promise.resolve({ agentId: "mock", agentName: "mock", resolved: true, shouldDelegate: false }),
      isToolSubAgentRunning: () => false,
      injectToolSubAgentMessage: () => false,
      listToolSubAgents: () => [],
      setActiveAgent: () => true,
    }));

    const mod = await import(`@/ui/pages/session/index.tsx?homeprompt=${Date.now()}`);
    const { Session } = mod;

    setup = await testRender(
      () => (
        <ThemeProvider initialTheme="one-dark">
          <Session sessionId="ses_home_prompt_test" config={REAL_CONFIG} />
        </ThemeProvider>
      ),
      { height: 20, width: 120 },
    );

    globalBus.publish(AppEvent.HomePromptSubmit, {
      message: "从首页带来的首条消息",
      sessionId: "ses_home_prompt_test",
    });

    await settle();

    expect(sendCalls).toEqual(["从首页带来的首条消息"]);
  });
});
