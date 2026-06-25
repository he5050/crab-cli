/**
 * Team 提示词构造模块 — 为队友生成系统提示与上下文提示。
 *
 * 职责:
 *   - 基于 Agent 信息拼接系统提示
 *   - 注入队友名册与任务列表上下文
 *   - 暴露时间/平台/工作目录等运行时信息
 *
 * 模块功能:
 *   - buildTeammateSystemPrompt: 构造队友系统提示
 *   - buildTeamContext: 构造队友运行时上下文
 *   - BuildTeammateSystemPromptInput / BuildTeamContextInput: 入参
 */
import { getAgent } from "@/agent";
import type { TeamTask, Teammate } from "../types";
import { iconWarning } from "@/core/icons/icon";

export interface TeamPromptRuntime {
  projectDir?: string;
  platform?: NodeJS.Platform;
  date?: Date;
}

export interface BuildTeammateSystemPromptInput extends TeamPromptRuntime {
  mate: Teammate;
}

export interface BuildTeamContextInput {
  mate: Teammate;
  userPrompt: string;
  projectDir?: string;
  teammates: Teammate[];
  tasks: TeamTask[];
}

function formatPlatform(platform: NodeJS.Platform = process.platform): string {
  return platform === "darwin" ? "macOS" : platform === "win32" ? "Windows" : "Linux";
}

function formatDate(date: Date = new Date()): string {
  return date.toISOString().split("T")[0]!;
}

export function buildTeammateSystemPrompt(input: BuildTeammateSystemPromptInput): string {
  const { mate, projectDir, platform, date } = input;
  const parts: string[] = [];

  if (mate.agentName) {
    const agent = getAgent(mate.agentName);
    if (agent) {
      parts.push(agent.prompt);
      parts.push("");
      parts.push("---");
      parts.push("");
      parts.push("## 当前 Team 任务");
      parts.push(`你正在作为 Team 的队友 "${mate.name}" 执行特定任务。`);
      parts.push(`角色: ${mate.role}`);
      parts.push("");
      parts.push("<env>");
      if (mate.worktreePath) {
        parts.push(`  Working directory: ${mate.worktreePath} (Git worktree — 所有文件操作限制在此目录)`);
      }
      if (projectDir) {
        parts.push(`  Project root: ${projectDir}`);
      }
      parts.push(`  Platform: ${formatPlatform(platform)}`);
      parts.push(`  Today's date: ${formatDate(date)}`);
      if (mate.model) {
        parts.push(`  Model: ${mate.model}`);
      }
      parts.push("</env>");
      parts.push("");
      parts.push("## 核心规则");
      parts.push("- 你不能自己关闭 — team lead 控制你的生命周期");
      parts.push("- **不要执行 `git push`** — 所有 push 由 lead 在合并后处理");
      parts.push("- **所有文件路径必须相对于你的 worktree**(使用相对路径如 `src/utils/foo.ts`)");
      parts.push("- **完成所有分配的工作后，必须调用 `wait-for-messages` 并提供摘要**");
      parts.push("- 不要在没有调用 `wait-for-messages` 的情况下结束你的回合");
      parts.push("- 如果你需要修改文件但尚未获得 plan approval，请先使用 `request_plan_approval`");
      parts.push("- 用中文回复");
      return parts.join("\n");
    }
  }

  parts.push(`你是一个 AI 编程助手，正在作为 Team 的队友 "${mate.name}" 执行任务。`);
  if (mate.role) {
    parts.push(`你的角色: ${mate.role}`);
  }

  parts.push(`\n<env>`);
  if (mate.worktreePath) {
    parts.push(`  Working directory: ${mate.worktreePath} (Git worktree — 所有文件操作限制在此目录)`);
  }
  if (projectDir) {
    parts.push(`  Project root: ${projectDir}`);
  }
  parts.push(`  Platform: ${formatPlatform(platform)}`);
  parts.push(`  Today's date: ${formatDate(date)}`);
  if (mate.model) {
    parts.push(`  Model: ${mate.model}`);
  }
  parts.push(`</env>`);

  parts.push(`\n## 核心规则`);
  parts.push(`- 你不能自己关闭 — team lead 控制你的生命周期`);
  parts.push(`- **不要执行 \`git push\`** — 所有 push 由 lead 在合并后处理`);
  parts.push(`- **所有文件路径必须相对于你的 worktree**(使用相对路径如 \`src/utils/foo.ts\`)`);
  parts.push(`- **完成所有分配的工作后，必须调用 \`wait-for-messages\` 并提供摘要**`);
  parts.push(`- 不要在没有调用 \`wait-for-messages\` 的情况下结束你的回合`);
  parts.push(`- 如果你需要修改文件但尚未获得 plan approval，请先使用 \`request_plan_approval\``);
  parts.push(`- 用中文回复`);

  return parts.join("\n");
}

export function buildTeamContext(input: BuildTeamContextInput): string {
  const { mate, userPrompt, teammates, tasks } = input;
  const otherMates = teammates.filter((m) => m.id !== mate.id);

  let context = `${userPrompt}\n\n## Team Context
你是队友 "${mate.name}"。
${mate.worktreePath ? `你的工作目录 (Git worktree): ${mate.worktreePath}` : ""}
${mate.role ? `你的角色: ${mate.role}` : ""}

### ${iconWarning} Worktree 路径规则(强制执行)
- 所有文件操作限制在你的 worktree 内: \`${mate.worktreePath ?? "项目根目录"}\`
- 使用**相对路径**(如 \`src/utils/foo.ts\`)— 会自动解析到你的 worktree
- 你不能读写主工作区或其他队友的 worktree 中的文件
- \`terminal-execute\` 命令总是在你的 worktree 目录中执行
- \`git push\` 是禁止的 — lead 在合并后处理所有 push

### 其他队友`;

  if (otherMates.length > 0) {
    context += `\n${otherMates.map((t) => `- ${t.name}${t.role ? ` (${t.role})` : ""} [ID: ${t.id}]`).join("\n")}`;
  } else {
    context += "\n没有其他活跃队友。";
  }

  context += "\n\n### 共享任务列表";
  if (tasks.length > 0) {
    context += `\n${tasks
      .map((t) => {
        const deps = t.dependencies?.length ? ` (依赖: ${t.dependencies.join(", ")})` : "";
        const assignee = t.assigneeName ? ` [已分配: ${t.assigneeName}]` : t.assignee ? ` [已分配: ${t.assignee}]` : "";
        return `- [${t.status}] ${t.id}: ${t.title}${assignee}${deps}`;
      })
      .join("\n")}`;
  } else {
    context += "\n暂无任务。";
  }

  context += `

### 可用合成工具
- \`message_teammate\`: 发送消息给其他队友或 lead
- \`claim_task\`: 认领共享任务列表中的任务
- \`complete_task\`: 标记任务完成
- \`list_team_tasks\`: 查看当前任务列表
- \`wait-for-messages\`: **完成当前工作后必须调用**。阻塞等待新指令。

### 规则
- 你不能自己关闭 — team lead 控制你的生命周期
- **不要执行 \`git push\`**。所有 push 由 lead 处理
- **所有文件路径必须相对于你的 worktree**
- **完成所有分配的工作后，必须调用 \`wait-for-messages\` 并提供摘要**
- 不要在没有调用 \`wait-for-messages\` 的情况下结束你的回合`;

  return context;
}
