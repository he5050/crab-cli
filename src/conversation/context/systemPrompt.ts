/**
 * 系统提示词构建 — Skill 上下文 + 编辑器上下文注入。
 *
 * 从 conversationHandler.ts 提取的独立逻辑。
 *
 * 依赖说明: @ide/context 在非 IDE 环境下由 hasEditorContext() 安全降级为 false，
 * 无需运行时检测或动态导入。
 */

import { buildEditorContextPrompt, hasEditorContext } from "@/ide/context";

export interface SystemPromptState {
  systemPrompt: string;
  activeSkillContext?: string;
}

/**
 * 构建当前完整的系统提示词(含 Skill 上下文 + 编辑器上下文)。
 */
export function getEffectiveSystemPrompt(state: SystemPromptState): string {
  let prompt = state.systemPrompt;

  if (hasEditorContext()) {
    const editorCtx = buildEditorContextPrompt();
    if (editorCtx) {
      prompt = prompt ? `${prompt}\n${editorCtx}` : editorCtx.trim();
    }
  }

  if (state.activeSkillContext) {
    const skillSection = [
      "",
      "## 当前激活技能",
      "你正在执行一个 Skill，请严格遵循以下 Skill 指令:",
      "",
      state.activeSkillContext,
      "",
    ].join("\n");
    prompt = prompt ? `${prompt}\n${skillSection}` : skillSection.trim();
  }

  return prompt;
}
