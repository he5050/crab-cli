/**
 * 会话斜杠命令 — 解析并执行 `/xxx` 形式的快捷指令。
 *
 * 职责:
 *   - 解析 `/command args` 形式文本
 *   - 分发到命令面板/Undo/Redo/AgentPicker/Timeline 等模块
 */
import type { Setter } from "solid-js";
import { getCommandRegistry } from "@commandPalette";
import { globalBus, type EventBus } from "@/bus";
import { AppEvent } from "@/bus";
import { createLogger } from "@/core/logging/logger";
import type { ChatMessage } from "@/ui/contexts/chat";
import type { Route, RouteContextValue } from "@/ui/contexts/route";
import { buildSessionDiffRoute } from "@/ui/pages/session/components/toolDiffRoute";

const log = createLogger("ui:session:slash");

export interface ParsedSessionSlashCommand {
  command: string;
  args?: string;
}

export interface HandleSessionSlashCommandOptions {
  messages: () => ChatMessage[];
  sessionId?: string;
  route?: Pick<RouteContextValue, "navigate">;
  setShowAgentPicker: Setter<boolean>;
  setShowTimeline: Setter<boolean>;
  undoLastTurn: () => void;
  redoLastTurn: () => void;
}

export function parseSessionSlashCommand(value: string): ParsedSessionSlashCommand | undefined {
  const trimmed = value.trim();
  if (!trimmed.startsWith("/")) {
    return undefined;
  }
  const fullText = trimmed.slice(1);
  const firstSpace = fullText.indexOf(" ");
  const command = firstSpace !== -1 ? fullText.slice(0, firstSpace) : fullText;
  if (!command) {
    return undefined;
  }
  const args = firstSpace !== -1 ? fullText.slice(firstSpace + 1) : undefined;
  return { command, ...(args !== undefined ? { args } : {}) };
}

export function handleSessionSlashCommand(
  value: string,
  options: HandleSessionSlashCommandOptions,
  eventBus: EventBus = globalBus,
): boolean {
  const parsed = parseSessionSlashCommand(value);
  if (!parsed) {
    return false;
  }

  const slashCmd = parsed.command;
  const slashArgs = parsed.args;

  if (slashCmd === "agents" || slashCmd === "agent") {
    options.setShowAgentPicker(true);
    return true;
  }

  if (slashCmd === "export") {
    import("@/ui/utils/export").then(({ exportConversation }) => {
      exportConversation(options.messages(), options.sessionId, eventBus);
    });
    return true;
  }

  if (slashCmd === "undo") {
    options.undoLastTurn();
    return true;
  }

  if (slashCmd === "redo") {
    options.redoLastTurn();
    return true;
  }

  if (slashCmd === "timeline") {
    options.setShowTimeline(true);
    return true;
  }

  if (slashCmd === "diff" && (!slashArgs?.trim() || slashArgs.trim() === "session")) {
    const returnRoute: Route | undefined = options.sessionId
      ? { sessionId: options.sessionId, type: "session" }
      : undefined;
    const sessionDiffRoute = buildSessionDiffRoute(options.messages(), returnRoute);
    if (sessionDiffRoute && options.route) {
      options.route.navigate(sessionDiffRoute);
      return true;
    }
    if (slashArgs?.trim() === "session") {
      eventBus.publish(AppEvent.Toast, { message: "当前 Session 没有可展示的工具 diff", variant: "info" });
      return true;
    }
  }

  const registry = getCommandRegistry();
  registry.executeSlash(slashCmd, slashArgs).then((found) => {
    if (found) {
      log.info(`斜杠命令执行: /${slashCmd}`);
    } else {
      log.warn(`未知斜杠命令: /${slashCmd}`);
      eventBus.publish(AppEvent.Toast, { message: `未知命令: /${slashCmd}`, variant: "warning" });
    }
  });
  return true;
}
