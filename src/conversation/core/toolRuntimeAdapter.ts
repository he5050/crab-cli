import { getBuiltinGroupName, getRegisteredTools } from "@/tool/registry/toolRegistry";
import type { ExternalToolResolution } from "@/tool/registry/externalToolResolver";
import { isReadOnlyMode, type ChatMode } from "@/agent/prompt/modes";
import { createId } from "@/core/identity";
import { recordConversationToolUsage } from "../lifecycle/conversationUsageMemory";
import type { HandlerContext } from "./toolExecution";
import { executeToolCalls } from "./toolExecution";
import type { ToolExecutor as LlmLoopToolExecutor, ToolExecutionContext } from "../types/loop";

export interface BuildConversationToolExecutorInput {
  buildHandlerContext: () => HandlerContext;
  enableExternalToolForSession: (query: string) => ExternalToolResolution;
  enableExternalToolsFromDiscoveryResult: (output: unknown) => string[];
  enableSkillsFromToolResult: (
    toolName: string,
    output: unknown,
  ) => { discovered: string[]; active: string[]; loaded: string[] };
  getMode: () => ChatMode | undefined;
  getVisibleTools: () => Record<string, unknown> | undefined;
  isExternalToolEnabled: (toolName: string) => boolean;
  messages: import("ai").ModelMessage[];
}

function toToolExecutionResult(result: { isError?: boolean; output?: unknown } | undefined) {
  return {
    error: result?.isError ? String(result?.output ?? "Unknown error") : undefined,
    output: result?.output ?? "",
    success: !result?.isError,
  };
}

async function executeSingleToolCall(
  input: BuildConversationToolExecutorInput,
  toolName: string,
  args: unknown,
  toolCallId?: string,
) {
  const toolCalls = [{ args, toolCallId: toolCallId ?? createId("call"), toolName }];
  return executeToolCalls(input.buildHandlerContext(), toolCalls);
}

function resolveInvisibleTool(input: BuildConversationToolExecutorInput, toolName: string) {
  const currentMode = input.getMode();
  if (currentMode && isReadOnlyMode(currentMode)) {
    return {
      error: `外部工具 ${toolName} 在 ${currentMode} 模式下未启用；请切换到非只读模式或使用当前模式允许的内置只读工具。`,
      output: { error: `外部工具 ${toolName} 在 ${currentMode} 模式下未启用` },
      success: false,
    };
  }

  const resolution = input.enableExternalToolForSession(toolName);
  if (resolution.status === "unique" && resolution.toolName === toolName) {
    if (!input.isExternalToolEnabled(resolution.toolName)) {
      return {
        error: `外部工具 ${toolName} 已被配置禁用，不能加入当前会话可用工具集。`,
        output: { error: `外部工具 ${toolName} 已被配置禁用，不能加入当前会话可用工具集` },
        success: false,
      };
    }
    return {
      output: `外部工具 ${toolName} 已加入当前会话可用工具集，下一轮 LLM 请求可直接调用。`,
      success: true,
    };
  }
  if (resolution.status === "ambiguous") {
    return {
      error: `外部工具名称不明确: ${toolName}，候选: ${resolution.candidates.join(", ")}`,
      output: { candidates: resolution.candidates, error: `外部工具名称不明确: ${toolName}` },
      success: false,
    };
  }
  return {
    error: `未知或未暴露工具: ${toolName}。请先使用 tool-search 发现可用外部工具。`,
    output: { error: `未知或未暴露工具: ${toolName}` },
    success: false,
  };
}

function buildToolExecutionOutput(
  input: BuildConversationToolExecutorInput,
  toolName: string,
  args: unknown,
  result: { isError?: boolean; output?: unknown } | undefined,
) {
  if (result && toolName !== "tool-search") {
    recordConversationToolUsage({
      args,
      messages: input.messages,
      output: result.output,
      success: !result.isError,
      toolName,
    });
  }

  const enabledExternalTools =
    toolName === "tool-search" && result && !result.isError
      ? input.enableExternalToolsFromDiscoveryResult(result.output)
      : [];
  const enabledSkills =
    result && !result.isError
      ? input.enableSkillsFromToolResult(toolName, result.output)
      : { active: [] as string[], discovered: [] as string[], loaded: [] as string[] };
  const enabledSkillCount = enabledSkills.discovered.length + enabledSkills.active.length + enabledSkills.loaded.length;

  const output =
    enabledExternalTools.length > 0 || enabledSkillCount > 0
      ? {
          ...(result?.output && typeof result.output === "object"
            ? (result.output as Record<string, unknown>)
            : { result: result?.output }),
          ...(enabledExternalTools.length > 0 ? { sessionEnabledExternalTools: enabledExternalTools } : {}),
          ...(enabledSkills.discovered.length > 0 ? { sessionDiscoveredSkills: enabledSkills.discovered } : {}),
          ...(enabledSkills.active.length > 0 ? { sessionActiveSkills: enabledSkills.active } : {}),
          ...(enabledSkills.loaded.length > 0 ? { sessionLoadedSkills: enabledSkills.loaded } : {}),
          message: [
            enabledExternalTools.length > 0
              ? `已将外部工具 ${enabledExternalTools.join(", ")} 加入当前会话可用工具集，下一轮 LLM 请求可直接调用。`
              : undefined,
            enabledSkills.discovered.length > 0
              ? `已发现 Skills ${enabledSkills.discovered.join(", ")}，后续不需要重复 recommend/search。`
              : undefined,
            enabledSkills.active.length > 0
              ? `已激活 Skills ${enabledSkills.active.join(", ")}，后续可直接调用 skills info/execute。`
              : undefined,
            enabledSkills.loaded.length > 0
              ? `已加载 Skills ${enabledSkills.loaded.join(", ")}，完整 Skill prompt 已生成。`
              : undefined,
          ]
            .filter(Boolean)
            .join("\n"),
        }
      : (result?.output ?? "");

  return {
    error: result?.isError ? String(result?.output ?? "Unknown error") : undefined,
    output,
    success: !result?.isError,
  };
}

export function buildConversationToolExecutor(input: BuildConversationToolExecutorInput): LlmLoopToolExecutor {
  return {
    execute: async (toolName: string, args: unknown, context: ToolExecutionContext) => {
      const visibleTools = input.getVisibleTools() ?? {};
      if (!visibleTools[toolName]) {
        const registeredTool = getRegisteredTools()[toolName];
        if (registeredTool && getBuiltinGroupName(toolName)) {
          const toolResults = await executeSingleToolCall(input, toolName, args, context.toolCallId);
          return toToolExecutionResult(toolResults[0]);
        }
        return resolveInvisibleTool(input, toolName);
      }

      const toolResults = await executeSingleToolCall(input, toolName, args, context.toolCallId);
      return buildToolExecutionOutput(input, toolName, args, toolResults[0]);
    },
  };
}
