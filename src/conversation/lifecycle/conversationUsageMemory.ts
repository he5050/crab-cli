/**
 * 对话使用记忆 — 把当前轮次使用的工具/场景记录到使用量记忆。
 *
 * 职责:
 *   - 在每轮对话结束后将实际使用的工具与场景写入 usageMemory
 *   - 为后续推荐与自适应调度提供历史依据
 *
 * 模块功能:
 *   - currentTurnScenario: 推断本轮的场景标签
 *   - recordTurnUsage: 记录本轮使用的工具/场景
 */
import type { ModelMessage } from "ai";
import { getBuiltinGroupName } from "@/tool/registry/toolRegistry";
import { recordUsageMemory } from "@/tool/usageMemory";

function currentTurnScenario(messages: ModelMessage[], args: unknown): string {
  const lastUser = [...messages].toReversed().find((message) => message.role === "user");
  const content = typeof lastUser?.content === "string" ? lastUser.content : "";
  if (content.trim()) {
    return content;
  }
  try {
    return JSON.stringify(args).slice(0, 120);
  } catch {
    return "";
  }
}

export function recordConversationToolUsage(input: {
  toolName: string;
  args: unknown;
  output: unknown;
  success: boolean;
  messages: ModelMessage[];
}): void {
  const { toolName, args, output, success, messages } = input;
  const scenario = currentTurnScenario(messages, args);

  if (toolName === "skills") {
    if (!output || typeof output !== "object") {
      return;
    }
    const record = output as { success?: unknown; action?: unknown; skill?: unknown; skillName?: unknown };
    const action = typeof record.action === "string" ? record.action : "";
    if (action !== "info" && action !== "execute") {
      return;
    }
    const skillName =
      typeof record.skillName === "string"
        ? record.skillName
        : record.skill && typeof record.skill === "object"
          ? (record.skill as { name?: unknown }).name
          : undefined;
    if (typeof skillName === "string") {
      recordUsageMemory({
        kind: "skill",
        name: skillName,
        permissionsPassed: success,
        projectDir: process.cwd(),
        scenario,
        source: action === "execute" ? "execute" : "info",
        success,
      });
    }
    return;
  }

  const isExternal = !getBuiltinGroupName(toolName);
  if (isExternal) {
    recordUsageMemory({
      kind: "external_tool",
      name: toolName,
      permissionsPassed: success,
      projectDir: process.cwd(),
      scenario,
      source: "direct_call",
      success,
    });
  }
}
