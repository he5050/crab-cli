/**
 * 会话侧栏视图 — 任务列表/历史/上下文/状态聚合渲染。
 *
 * 职责:
 *   - 渲染会话侧栏的所有面板
 *   - 协调各子组件之间的状态切换
 */
import { RGBA } from "@opentui/core";
import { useKeyboard } from "@opentui/solid";
import type { AgentInfo } from "@agent";
import type { AppConfigSchema } from "@/schema/config";
import type { ChatMessage } from "@/ui/contexts/chat";
import type { ExtendedThemeColors, ThemeColors } from "@/ui/contexts/theme";
import { type ContextStats, type LspDiagnosticItem, SidebarPanel } from "@/ui/pages/session/components/sidebar";
import type { SessionTodoItem } from "@/ui/pages/session/components/sidebarTodos";
import { SIDEBAR_COLLAPSED_WIDTH, SIDEBAR_WIDTH } from "@/ui/themes/sessionTokens";
import type { Breakpoint } from "@/ui/themes/sessionTokens";

export interface SessionSidebarTaskItem {
  id: string;
  label: string;
  status: "pending" | "running" | "done" | "error";
}

export function SessionSidebarView(props: {
  visible: () => boolean;
  breakpoint: () => Breakpoint;
  colors: ThemeColors;
  extended?: ExtendedThemeColors;
  sessionID?: string;
  tasks: SessionSidebarTaskItem[];
  messages: ChatMessage[];
  config: AppConfigSchema;
  agentInfo?: AgentInfo;
  agentStatus?: string;
  onAgentClick: () => void;
  mode?: string;
  yoloOverlay?: boolean;
  lspDiagnostics: LspDiagnosticItem[];
  todos: SessionTodoItem[];
  onTodoOpen: () => void;
  contextStats?: ContextStats;
  onCollapse: () => void;
  onExpand: () => void;
}) {
  const sidebar = () => (
    <SidebarPanel
      colors={props.colors}
      extended={props.extended}
      sessionID={props.sessionID}
      tasks={props.tasks}
      messages={props.messages}
      config={props.config}
      agentInfo={props.agentInfo}
      agentStatus={props.agentStatus}
      onAgentClick={props.onAgentClick}
      mode={props.mode}
      yoloOverlay={props.yoloOverlay}
      lspDiagnostics={props.lspDiagnostics}
      todos={props.todos}
      onTodoOpen={props.onTodoOpen}
      contextStats={props.contextStats}
      onCollapse={props.onCollapse}
      width={SIDEBAR_WIDTH}
    />
  );

  const bp = () => props.breakpoint();

  const showInline = () => bp() === "wide" || bp() === "xlarge";
  const showOverlay = () => bp() === "medium";

  useKeyboard((event) => {
    if (event.name === "escape" && showOverlay() && props.visible()) {
      props.onCollapse();
      event.stopPropagation();
    }
  });

  return (
    <>
      {props.visible() ? (
        showInline() ? (
          sidebar()
        ) : showOverlay() ? (
          <box
            position="absolute"
            top={0}
            left={0}
            right={0}
            bottom={0}
            alignItems="flex-end"
            backgroundColor={RGBA.fromInts(0, 0, 0, 70)}
            zIndex={90}
            onMouseDown={(e) => {
              e.stopPropagation();
              props.onCollapse();
            }}
          >
            {sidebar()}
          </box>
        ) : null
      ) : (
        <box
          width={SIDEBAR_COLLAPSED_WIDTH}
          border={["left"]}
          borderColor={props.colors.muted}
          flexGrow={0}
          onMouseUp={props.onExpand}
        >
          <box flexDirection="column" justifyContent="center" alignItems="center">
            <text fg={props.colors.muted}>◂</text>
          </box>
        </box>
      )}
    </>
  );
}
