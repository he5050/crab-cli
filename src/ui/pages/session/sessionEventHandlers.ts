/**
 * 会话事件处理器注册 — 订阅/分发与本会话相关的全局事件。
 *
 * 职责:
 *   - 注册/卸载 SessionEvent 子集的事件处理
 *   - 协调 Agent/Role/Skill/Team 等弹窗的显示状态
 */
import type { Setter } from "solid-js";
import { useEventBus } from "@/ui/contexts/eventBus";
import { AppEvent } from "@/bus";
import { type SessionTodoItem, normalizeTodoItem, sortSessionTodos } from "@/ui/pages/session/components/sidebarTodos";

export interface RegisterSessionEventHandlersOptions {
  sessionId?: string;
  loading: () => boolean;
  send: (message: string) => void | Promise<unknown>;
  runInSessionOwner: (fn: () => void) => void;
  setShowAgentPicker: Setter<boolean>;
  setShowRolePicker: Setter<boolean>;
  setShowSkillPicker: Setter<boolean>;
  setShowSkillCreation: Setter<boolean>;
  setShowSkillList: Setter<boolean>;
  setShowTeamPanel: Setter<boolean>;
  setShowTaskPanel: Setter<boolean>;
  setShowTimeline: Setter<boolean>;
  setSyncedTodos: Setter<SessionTodoItem[]>;
  setSidebarVisible: Setter<boolean>;
  undoLastTurn: () => void;
  redoLastTurn: () => void;
  toggleMessageConceal: () => void;
}

export function registerSessionEventHandlers(options: RegisterSessionEventHandlersOptions): () => void {
  const eventBus = useEventBus();
  const unsubs = [
    eventBus.subscribe(AppEvent.AgentSelected, () => {
      options.runInSessionOwner(() => options.setShowAgentPicker(false));
    }),
    eventBus.subscribe(AppEvent.RolePickerShow, () => {
      options.runInSessionOwner(() => options.setShowRolePicker(true));
    }),
    eventBus.subscribe(AppEvent.AgentPickerShow, () => {
      options.runInSessionOwner(() => options.setShowAgentPicker(true));
    }),
    eventBus.subscribe(AppEvent.SkillPickerShow, () => {
      options.runInSessionOwner(() => options.setShowSkillPicker(true));
    }),
    eventBus.subscribe(AppEvent.SkillCreationShow, () => {
      options.runInSessionOwner(() => options.setShowSkillCreation(true));
    }),
    eventBus.subscribe(AppEvent.SkillListShow, () => {
      options.runInSessionOwner(() => options.setShowSkillList(true));
    }),
    eventBus.subscribe(AppEvent.TeamPanelShow, () => {
      options.runInSessionOwner(() => options.setShowTeamPanel(true));
    }),
    eventBus.subscribe(AppEvent.TaskPanelShow, () => {
      options.runInSessionOwner(() => options.setShowTaskPanel(true));
    }),
    eventBus.subscribe(AppEvent.TodoSync, (evt) => {
      options.runInSessionOwner(() => {
        const items = (evt.properties.items ?? [])
          .map((item: unknown) => normalizeTodoItem(item, "manual"))
          .filter((item): item is SessionTodoItem => Boolean(item));
        options.setSyncedTodos(sortSessionTodos(items));
      });
    }),
    eventBus.subscribe(AppEvent.SessionSidebarToggle, () => {
      options.runInSessionOwner(() => options.setSidebarVisible((visible) => !visible));
    }),
    eventBus.subscribe(AppEvent.SessionUndoRequested, () => {
      options.runInSessionOwner(() => options.undoLastTurn());
    }),
    eventBus.subscribe(AppEvent.SessionRedoRequested, () => {
      options.runInSessionOwner(() => options.redoLastTurn());
    }),
    eventBus.subscribe(AppEvent.SessionToggleConceal, () => {
      options.runInSessionOwner(() => options.toggleMessageConceal());
    }),
    eventBus.subscribe(AppEvent.TimelineShow, () => {
      options.runInSessionOwner(() => options.setShowTimeline(true));
    }),
    eventBus.subscribe(AppEvent.HomePromptSubmit, (evt) => {
      const payload = evt.properties;
      if (!options.sessionId || payload.sessionId !== options.sessionId) {
        return;
      }
      const message = payload.message.trim();
      if (!message) {
        return;
      }
      if (options.loading()) {
        return;
      }
      void options.send(message);
    }),
  ];

  return () => {
    for (const unsub of unsubs) {
      unsub();
    }
  };
}
