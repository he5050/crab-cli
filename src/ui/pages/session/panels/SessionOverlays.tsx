/**
 * Session 浮层面板组 — 收纳所有 position=absolute 弹窗
 *
 * 职责:
 *   - 集中渲染 AgentPicker / RolePicker / Skill 相关 / Team / Task / TodoList / Timeline / Stash 浮层
 *   - 集中渲染 PromptAutocomplete
 *   - 集中渲染 SessionTimelineDialog
 *
 * 边界:
 *   1. 纯展示:所有状态与回调由父组件提供
 *   2. 不管理浮层显隐，依赖 props
 *   3. 不直接修改全局状态
 */
import { Show } from "solid-js";
import { useEventBus } from "@/ui/contexts/eventBus";
import { AppEvent } from "@bus";
import { AgentPicker } from "@/ui/components/agentPicker";
import { RolePicker } from "@/ui/components/rolePicker";
import { SkillPicker } from "@/ui/components/skillPicker";
import { SkillCreationPanel } from "@/ui/components/skillCreationPanel";
import { SkillListPanel } from "@/ui/components/skillListPanel";
import { TeamPanel } from "@/ui/components/teamPanel";
import { TaskPanel } from "@/ui/components/taskPanel";
import { TodoListPanel } from "@/ui/components/todoListPanel";
import { DialogStash } from "@/ui/components/dialogStash";
import { SessionTimelineDialog } from "@/ui/pages/session/components/sessionTimelineDialog";
import { PromptAutocomplete } from "@/ui/pages/session/components/promptAutocomplete";
import { SURFACE_PANEL } from "@/ui/themes/sessionTokens";
import type { ThemeColors } from "@/ui/contexts/theme";
import type { AppConfigSchema } from "@/schema/config";
import type { ChatMessage } from "@/ui/contexts/chat";
import type { PromptAutocompleteOption } from "@/ui/pages/session/components/promptAutocomplete";
import type { TodoItem as TodoListPanelItem } from "@/ui/components/todoListPanel";

export interface SessionOverlaysProps {
  config: AppConfigSchema;
  colors: ThemeColors;
  showAgentPicker: () => boolean;
  setShowAgentPicker: (v: boolean) => void;
  showRolePicker: () => boolean;
  setShowRolePicker: (v: boolean) => void;
  showSkillPicker: () => boolean;
  setShowSkillPicker: (v: boolean) => void;
  showSkillCreation: () => boolean;
  setShowSkillCreation: (v: boolean) => void;
  showSkillList: () => boolean;
  setShowSkillList: (v: boolean) => void;
  showTeamPanel: () => boolean;
  setShowTeamPanel: (v: boolean) => void;
  showTaskPanel: () => boolean;
  setShowTaskPanel: (v: boolean) => void;
  showTodoList: () => boolean;
  setShowTodoList: (v: boolean) => void;
  showTimeline: () => boolean;
  setShowTimeline: (v: boolean) => void;
  showStashList: () => boolean;
  setShowStashList: (v: boolean) => void;
  messages: ChatMessage[];
  onSelectAgent: (name: string) => void;
  onMoveTimeline: (id: string) => void;
  onReuseFromTimeline: (text: string) => void;
  todoPanelItems: () => TodoListPanelItem[];
  promptStash: ReturnType<typeof import("@/ui/components/prompt/stash").usePromptStash>;
  restorePromptFromStash: (input: string) => void;
  promptAutocompleteVisible: () => boolean;
  promptAutocompleteOptions: () => PromptAutocompleteOption[];
  autocompleteIndex: () => number;
  setAutocompleteIndex: (n: number) => void;
  selectAutocompleteOption: (opt: PromptAutocompleteOption | undefined) => void;
}

export function SessionOverlays(props: SessionOverlaysProps) {
  const eventBus = useEventBus();
  return (
    <>
      {/* Agent 选择器浮层 */}
      <Show when={props.showAgentPicker()}>
        <box position="absolute" bottom="100%" left={0} width="100%" zIndex={100}>
          <AgentPicker
            config={props.config}
            onClose={() => props.setShowAgentPicker(false)}
            onSelect={(name) => {
              props.onSelectAgent(name);
              props.setShowAgentPicker(false);
            }}
          />
        </box>
      </Show>
      {/* 角色选择器浮层 */}
      <Show when={props.showRolePicker()}>
        <box position="absolute" bottom="100%" left={0} width="100%" zIndex={100}>
          <RolePicker onClose={() => props.setShowRolePicker(false)} onSelect={() => props.setShowRolePicker(false)} />
        </box>
      </Show>
      {/* Skill 选择器浮层 */}
      <Show when={props.showSkillPicker()}>
        <box position="absolute" bottom="100%" left={0} width="100%" zIndex={100}>
          <SkillPicker
            onClose={() => props.setShowSkillPicker(false)}
            onSelect={() => props.setShowSkillPicker(false)}
          />
        </box>
      </Show>
      {/* Skill 创建面板浮层 */}
      <Show when={props.showSkillCreation()}>
        <box position="absolute" bottom="100%" left={0} width="100%" zIndex={100}>
          <SkillCreationPanel
            onClose={() => props.setShowSkillCreation(false)}
            onCreated={() => {
              props.setShowSkillCreation(false);
              eventBus.publish(AppEvent.Toast, { message: "Skill 已创建", variant: "success" });
            }}
          />
        </box>
      </Show>
      {/* Skill 列表面板浮层 */}
      <Show when={props.showSkillList()}>
        <box position="absolute" bottom="100%" left={0} width="100%" zIndex={100}>
          <SkillListPanel onClose={() => props.setShowSkillList(false)} />
        </box>
      </Show>
      {/* Team 面板浮层 */}
      <Show when={props.showTeamPanel()}>
        <box position="absolute" bottom="100%" left={0} width="100%" zIndex={100}>
          <TeamPanel onClose={() => props.setShowTeamPanel(false)} />
        </box>
      </Show>
      {/* 任务管理面板浮层 */}
      <Show when={props.showTaskPanel()}>
        <box position="absolute" bottom="100%" left={0} width="100%" zIndex={100}>
          <TaskPanel onClose={() => props.setShowTaskPanel(false)} />
        </box>
      </Show>
      {/* TODO 管理面板浮层 */}
      <Show when={props.showTodoList()}>
        <box
          position="absolute"
          bottom="100%"
          left={0}
          width="100%"
          zIndex={100}
          backgroundColor={SURFACE_PANEL}
          border={true}
          borderColor={props.colors.primary}
        >
          <TodoListPanel todos={props.todoPanelItems()} onClose={() => props.setShowTodoList(false)} />
        </box>
      </Show>
      {/* 时间线浮层 */}
      <Show when={props.showTimeline()}>
        <SessionTimelineDialog
          messages={props.messages}
          onClose={() => props.setShowTimeline(false)}
          onMove={props.onMoveTimeline}
          onReusePrompt={(text) => {
            props.onReuseFromTimeline(text);
            props.setShowTimeline(false);
          }}
        />
      </Show>
      {/* Stash 浮层 */}
      <Show when={props.showStashList()}>
        <DialogStash
          stash={props.promptStash}
          onClose={() => props.setShowStashList(false)}
          onSelect={(entry) => {
            props.restorePromptFromStash(entry.input);
            props.setShowStashList(false);
          }}
        />
      </Show>
      {/* 自动补全 */}
      <PromptAutocomplete
        visible={props.promptAutocompleteVisible()}
        options={props.promptAutocompleteOptions()}
        selectedIndex={Math.min(props.autocompleteIndex(), Math.max(0, props.promptAutocompleteOptions().length - 1))}
        onMove={(index) => props.setAutocompleteIndex(index)}
        onSelect={props.selectAutocompleteOption}
      />
    </>
  );
}
