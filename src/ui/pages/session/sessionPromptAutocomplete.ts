/**
 * 会话 Prompt 自动补全数据源 — 组装命令/最近文件/Agent/Skill。
 *
 * 职责:
 *   - 规范化最近文件路径
 *   - 组装 PromptAutocompleteSources 供 promptAutocomplete 组件使用
 */
import type { PromptAutocompleteSources } from "@/ui/pages/session/components/promptAutocomplete";

type SessionPromptAutocompleteCommand = PromptAutocompleteSources["commands"][number];

export function normalizeSessionRecentFile(filePath: string, cwd: string = process.cwd()): string {
  const normalizedCwd = cwd.replace(/\/+$/, "");
  return filePath.startsWith(`${normalizedCwd}/`) ? filePath.slice(normalizedCwd.length + 1) : filePath;
}

export function buildSessionPromptAutocompleteSources(input: {
  commands: SessionPromptAutocompleteCommand[];
  recentFiles: string[];
  agents: string[];
  skills: string[];
  cwd?: string;
  maxRecentFiles?: number;
}): PromptAutocompleteSources {
  const maxRecentFiles = input.maxRecentFiles ?? 24;
  return {
    agents: input.agents,
    commands: input.commands,
    recentFiles: input.recentFiles.map((file) => normalizeSessionRecentFile(file, input.cwd)).slice(0, maxRecentFiles),
    skills: input.skills,
  };
}

export function nextAutocompleteIndex(current: number, itemCount: number, direction: -1 | 1): number {
  if (itemCount <= 0) {
    return 0;
  }
  const next = current + direction;
  if (next < 0) {
    return itemCount - 1;
  }
  if (next >= itemCount) {
    return 0;
  }
  return next;
}
