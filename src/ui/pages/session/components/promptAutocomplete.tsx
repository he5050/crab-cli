/**
 * Prompt 自动完成组件 — 命令、文件、Agent、Skill 的智能补全。
 *
 * 职责:
 *   - 提供多种类型的自动完成选项
 *   - 支持模糊匹配搜索
 *   - 处理键盘导航和选择
 *   - 管理触发器(/ 命令、@ 文件/Agent/Skill)
 *
 * 模块功能:
 *   - PromptAutocompleteKind: 自动完成类型
 *   - PromptAutocompleteOption: 自动完成选项结构
 *   - PromptAutocompleteSources: 数据源结构
 *   - buildPromptAutocompleteOptions: 构建自动完成选项列表
 *   - applyPromptAutocompleteSelection: 应用用户选择的选项
 *   - PromptAutocomplete: 自动完成下拉组件
 *   - fuzzyMatch: 模糊匹配算法
 *
 * 使用场景:
 *   - prompt 输入框的智能补全
 *   - / 命令补全
 *   - @ 文件/Agent/Skill 引用补全
 *
 * 边界:
 *   1. 仅负责 UI 展示和选项构建，不涉及输入框实现
 *   2. 支持 4 种类型:command/file/agent/skill
 *   3. 最多显示 12 个选项
 *   4. 依赖 promptParts 模块处理引用插入
 *   5. 选中 file/agent/skill 时同时返回 extmark 供父组件创建虚拟文本
 *
 * 流程:
 *   1. 用户输入触发字符(/ 或 @)
 *   2. 调用 buildPromptAutocompleteOptions 构建选项
 *   3. 显示下拉列表供用户选择
 *   4. 用户通过键盘或鼠标选择选项
 *   5. 调用 applyPromptAutocompleteSelection 应用选择(可选返回 extmark)
 */
import { For, Show } from "solid-js";
import { useTheme } from "@/ui/contexts/theme";
import {
  type PromptReference,
  type PromptTrigger,
  insertPromptReference,
} from "@/ui/pages/session/components/promptParts";
import {
  type Extmark,
  createAgentExtmark,
  createFileExtmark,
  createSkillExtmark,
} from "@/ui/pages/session/components/promptExtmarks";

export type PromptAutocompleteKind = "command" | "file" | "agent" | "skill";

export interface PromptAutocompleteOption {
  id: string;
  kind: PromptAutocompleteKind;
  display: string;
  value: string;
  raw: string;
  description?: string;
}

export interface PromptAutocompleteSources {
  commands: {
    name: string;
    title: string;
    description?: string;
    slashName?: string;
    slashAliases?: string[];
  }[];
  recentFiles: string[];
  agents: string[];
  skills: string[];
}

function fuzzyMatch(query: string, target: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) {
    return true;
  }
  const t = target.toLowerCase();
  if (t.includes(q)) {
    return true;
  }
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      qi++;
    }
  }
  return qi === q.length;
}

function visibleText(option: PromptAutocompleteOption): string {
  return [option.display, option.value, option.description ?? ""].join(" ");
}

export function buildPromptAutocompleteOptions(
  trigger: PromptTrigger,
  query: string,
  sources: PromptAutocompleteSources,
): PromptAutocompleteOption[] {
  if (trigger === "/") {
    if (/\s/.test(query)) {
      return [];
    }
    return sources.commands
      .filter((cmd) => cmd.slashName)
      .map((cmd): PromptAutocompleteOption => {
        const slash = cmd.slashName!;
        return {
          description: cmd.description ?? cmd.title,
          display: `/${slash}`,
          id: `command:${cmd.name}`,
          kind: "command",
          raw: `/${slash} `,
          value: slash,
        };
      })
      .filter((option) => fuzzyMatch(query, visibleText(option)))
      .slice(0, 12);
  }

  const fileOptions = sources.recentFiles.map(
    (file): PromptAutocompleteOption => ({
      description: "recent file",
      display: `@${file}`,
      id: `file:${file}`,
      kind: "file",
      raw: `@${file}`,
      value: file,
    }),
  );

  const agentOptions = sources.agents.map(
    (agent): PromptAutocompleteOption => ({
      description: "agent",
      display: `@agent:${agent}`,
      id: `agent:${agent}`,
      kind: "agent",
      raw: `@agent:${agent}`,
      value: `agent:${agent}`,
    }),
  );

  const skillOptions = sources.skills.map(
    (skill): PromptAutocompleteOption => ({
      description: "skill",
      display: `@skill:${skill}`,
      id: `skill:${skill}`,
      kind: "skill",
      raw: `@skill:${skill}`,
      value: `skill:${skill}`,
    }),
  );

  return [...agentOptions, ...skillOptions, ...fileOptions]
    .filter((option) => fuzzyMatch(query, visibleText(option).replace(/^@/, "")))
    .slice(0, 12);
}

/** 自动完成选择结果 */
export interface AutocompleteSelectionResult {
  /** 更新后的输入框文本 */
  value: string;
  /** 选择 file/agent/skill 时创建的 extmark(command 不创建) */
  extmark?: Extmark;
}

export function applyPromptAutocompleteSelection(
  value: string,
  trigger: PromptTrigger,
  option: PromptAutocompleteOption,
): AutocompleteSelectionResult {
  if (trigger === "/") {
    return { value: option.raw };
  }

  const ref: PromptReference = {
    kind: option.kind === "agent" || option.kind === "skill" ? option.kind : "file",
    raw: option.raw,
    value: option.value,
  };
  const nextValue = insertPromptReference(value, ref);

  // 根据选项类型创建对应的 extmark
  let extmark: Extmark | undefined;
  const insertPosition = nextValue.trimEnd().length - option.raw.length;
  const safePosition = Math.max(0, insertPosition);

  switch (option.kind) {
    case "file":
      extmark = createFileExtmark(option.value, safePosition);
      break;
    case "agent":
      extmark = createAgentExtmark(option.value.replace(/^agent:/, ""), safePosition);
      break;
    case "skill":
      extmark = createSkillExtmark(option.value.replace(/^skill:/, ""), safePosition);
      break;
    default:
      break;
  }

  return { extmark, value: nextValue };
}

export function PromptAutocomplete(props: {
  visible: boolean;
  options: PromptAutocompleteOption[];
  selectedIndex: number;
  onMove: (index: number) => void;
  onSelect: (option: PromptAutocompleteOption) => void;
  emptyText?: string;
}) {
  const theme = useTheme();
  const c = theme.colors;
  const selectedFg = () => theme.selectedForeground(c.primary);

  return (
    <Show when={props.visible}>
      <box
        position="absolute"
        bottom="100%"
        left={0}
        width="100%"
        zIndex={120}
        flexDirection="column"
        backgroundColor={theme.extended.bg.panel}
        border={true}
        borderColor={c.border}
      >
        <Show
          when={props.options.length > 0}
          fallback={
            <box paddingLeft={1} paddingRight={1}>
              <text fg={c.muted}>{props.emptyText ?? "No matching items"}</text>
            </box>
          }
        >
          <For each={props.options}>
            {(option, index) => {
              const selected = () => index() === props.selectedIndex;
              return (
                <box
                  flexDirection="row"
                  paddingLeft={1}
                  paddingRight={1}
                  backgroundColor={selected() ? c.primary : undefined}
                  onMouseOver={() => props.onMove(index())}
                  onMouseUp={() => props.onSelect(option)}
                >
                  <text fg={selected() ? selectedFg() : c.text} wrapMode="none">
                    {selected() ? "> " : "  "}
                    {option.display}
                  </text>
                  <Show when={option.description}>
                    <text fg={selected() ? selectedFg() : c.muted} wrapMode="none">
                      {"  "}
                      {option.description}
                    </text>
                  </Show>
                </box>
              );
            }}
          </For>
        </Show>
        <box paddingLeft={1} paddingRight={1}>
          <text fg={c.muted}>↑↓ select · Enter confirm · Tab complete · Esc close</text>
        </box>
      </box>
    </Show>
  );
}
