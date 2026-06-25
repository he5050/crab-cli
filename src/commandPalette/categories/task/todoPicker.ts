/**
 * 命令面板 Todo 选择器模板模块 — 预置开发/审查等场景的待办模板。
 *
 * 职责:
 *   - 提供常见场景的 Todo 模板
 *   - 让命令面板快速套用模板创建任务
 *
 * 模块功能:
 *   - TODO_PICKER_TEMPLATES: 场景模板字典
 *   - TodoTemplate: 模板结构
 */
import type { CommandDeps } from "../../shared";
import { globalBus, type EventBus } from "@/bus";
import { AppEvent } from "@/bus";

export interface TodoTemplate {
  title: string;
  items: string[];
}

export const TODO_PICKER_TEMPLATES: Record<string, TodoTemplate> = {
  bug: {
    items: ["复现问题", "定位原因", "编写修复", "测试验证", "回归测试"],
    title: "Bug 修复",
  },
  dev: {
    items: ["需求分析", "技术设计", "编码实现", "代码审查", "测试验证", "部署上线"],
    title: "开发任务",
  },
  plan: {
    items: ["目标定义", "范围界定", "任务分解", "时间估算", "资源分配"],
    title: "项目规划",
  },
  review: {
    items: ["功能理解", "代码阅读", "问题记录", "反馈建议", "跟踪修复"],
    title: "代码审查",
  },
};

export interface TodoPickerOptions {
  createTodoItem?: (content: string) => Promise<void>;
  publishLog?: (message: string) => void;
}

async function defaultCreateTodoItem(content: string): Promise<void> {
  const { todoUltraTool } = await import("@/tool/todo");
  await todoUltraTool.execute({ action: "create", content });
}

function defaultPublishLog(message: string, eventBus: EventBus = globalBus): void {
  eventBus.publish(AppEvent.Log, { level: "info", message });
}

export async function handleTodoPickerCommand(
  args: string | undefined,
  deps: CommandDeps,
  options: TodoPickerOptions = {},
  eventBus: EventBus = globalBus,
): Promise<void> {
  const template = args?.trim();
  const publishLog = options.publishLog ?? ((message: string) => defaultPublishLog(message, eventBus));

  if (!template) {
    const lines = [
      "📋 待办模板选择器",
      "",
      "可用模板:",
      ...Object.entries(TODO_PICKER_TEMPLATES).map(([key, t]) => `  /todo-picker ${key} — ${t.title}`),
      "",
      "用法: /todo-picker <template> — 从模板创建待办列表",
    ];
    publishLog(lines.join("\n"));
    return;
  }

  const selected = TODO_PICKER_TEMPLATES[template];
  if (!selected) {
    deps.showToast?.(`未知模板: ${template}，可用: ${Object.keys(TODO_PICKER_TEMPLATES).join(", ")}`, "warning");
    return;
  }

  const createTodoItem = options.createTodoItem ?? defaultCreateTodoItem;
  for (const item of selected.items) {
    await createTodoItem(item);
  }

  deps.showToast?.(`已从「${selected.title}」模板创建 ${selected.items.length} 个待办`, "success");
}
