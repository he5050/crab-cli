/**
 * Team 合成工具执行模块 — 处理 message_teammate / wait_for_messages 等内置合成工具。
 *
 * 职责:
 *   - 派发合成工具调用到对应处理分支
 *   - 维护队友间消息与任务列表状态
 *   - 将工具结果回填到 ModelMessage 流
 *
 * 模块功能:
 *   - executeSyntheticToolCalls: 批量执行合成工具调用
 *   - SyntheticToolCall: 合成工具调用结构
 */
import type { ModelMessage } from "ai";
import type { Teammate } from "../types";
import type { TeamTracker } from "../core/teamTracker";
import type { TeamTaskList } from "../core/teamTaskList";
import type { TeammateExecutionOptions } from "../mate/teamExecutorHelpers";
import { createToolResultMessage } from "@/conversation/message/messageFactories";

export interface SyntheticToolCall {
  toolName: string;
  toolCallId: string;
  args: unknown;
}

export interface ExecuteSyntheticToolCallsInput {
  calls: SyntheticToolCall[];
  mate: Teammate;
  tracker: TeamTracker;
  taskList: TeamTaskList;
  messages: ModelMessage[];
  onMessage?: TeammateExecutionOptions["onMessage"];
}
function pushToolResultMessage(messages: ModelMessage[], call: SyntheticToolCall, value: string): void {
  messages.push(createToolResultMessage(call.toolCallId, call.toolName, { type: "text", value }));
}

function emitToolResult(input: ExecuteSyntheticToolCallsInput, call: SyntheticToolCall, content: string): void {
  input.onMessage?.({
    content,
    teammateId: input.mate.id,
    teammateName: input.mate.name,
    toolName: call.toolName,
    type: "tool_result",
  });
}

function toStringArgs(args: unknown): Record<string, string> {
  return typeof args === "object" && args !== null ? (args as Record<string, string>) : {};
}

export async function executeSyntheticToolCalls(input: ExecuteSyntheticToolCallsInput): Promise<void> {
  const { calls, mate, tracker, taskList, messages } = input;

  for (const call of calls) {
    const args = toStringArgs(call.args);
    let resultContent = "";

    switch (call.toolName) {
      case "message_teammate": {
        const target = args.target ?? "";
        const content = args.content ?? "";

        if (target === "lead" || target === "Team Lead") {
          const sent = tracker.sendMessageToLead(mate.id, content);
          resultContent = sent ? "消息已发送给 team lead。" : "发送消息给 team lead 失败。";
        } else {
          const targetMate = tracker.findByName(target) ?? tracker.get(target);
          if (targetMate) {
            const sent = tracker.sendMessageToTeammate(mate.id, targetMate.id, content);
            resultContent = sent ? `消息已发送给 ${targetMate.name}。` : `发送消息给 ${target} 失败。`;
          } else {
            resultContent = `队友 "${target}" 未找到。使用 list_team_tasks 查看当前队友。`;
          }
        }
        break;
      }

      case "claim_task": {
        const taskId = args.task_id ?? "";
        try {
          const task = taskList.claim(taskId, mate.id, mate.name);
          if (task) {
            resultContent = `已认领任务 "${task.title}" (${taskId})。`;
          } else {
            resultContent = `任务 ${taskId} 未找到。`;
          }
        } catch (error) {
          resultContent = `认领任务失败: ${error instanceof Error ? error.message : String(error)}`;
        }
        break;
      }

      case "complete_task": {
        const taskId = args.task_id ?? "";
        const task = taskList.complete(taskId);
        if (task) {
          tracker.sendMessageToLead(mate.id, `任务完成: "${task.title}" (${taskId})`);
          resultContent = `任务 "${task.title}" 已标记为完成。`;
        } else {
          resultContent = `任务 ${taskId} 未找到。`;
        }
        break;
      }

      case "list_team_tasks": {
        const tasks = taskList.list();
        if (tasks.length === 0) {
          resultContent = "任务列表为空。";
        } else {
          resultContent = tasks
            .map((task) => {
              const deps = task.dependencies?.length ? ` (依赖: ${task.dependencies.join(", ")})` : "";
              const assignee = task.assigneeName
                ? ` [${task.assigneeName}]`
                : task.assignee
                  ? ` [${task.assignee}]`
                  : "";
              return `[${task.status}] ${task.id}: ${task.title}${assignee}${deps}`;
            })
            .join("\n");
        }
        break;
      }

      case "request_plan_approval": {
        const plan = args.plan ?? "";
        tracker.requestPlanApproval(mate.id, plan);
        resultContent = "计划已提交审批，等待 lead 回复...";
        break;
      }
    }

    pushToolResultMessage(messages, call, resultContent);
    emitToolResult(input, call, resultContent);
  }
}
