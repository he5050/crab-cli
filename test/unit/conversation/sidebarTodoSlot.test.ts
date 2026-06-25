/**
 * [测试目标] 侧边栏 Todo 槽位。
 *
 * 测试目标:
 *   - 验证 sidebarTodos / sidebar 组件在 todo 标准化、ultra phases 提取、修改文件汇总与 getting-started 卡片显示上的契约
 *
 * 测试用例:
 *   - normalizeTodoItem 标准化 todo-ultra 普通任务状态:状态 inProgress → in_progress、补充 source / default 字段
 *   - extractTodosFromMessages 提取 ultra phases tree 的 parentId 和 phaseId:解析 ultra 输出后保留 phase 关系
 *   - 其余用例覆盖 buildModifiedFilesFromMessages / shouldShowGettingStartedCard
 */
import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import type { ChatMessage } from "@/ui/contexts/chat";
import {
  extractTodosFromMessages,
  normalizeTodoItem,
  sortSessionTodos,
  summarizeTodos,
} from "@/ui/pages/session/components/sidebarTodos";
import { buildModifiedFilesFromMessages, shouldShowGettingStartedCard } from "@/ui/pages/session/components/sidebar";

describe("Sidebar Todo Slot", () => {
  test("normalizeTodoItem 标准化 todo-ultra 普通任务状态", () => {
    expect(
      normalizeTodoItem(
        {
          content: "实现 Todo Slot",
          id: "todo_1",
          priority: "high",
          status: "inProgress",
        },
        "manual",
      ),
    ).toEqual({
      content: "实现 Todo Slot",
      filePath: undefined,
      id: "todo_1",
      line: undefined,
      parentId: undefined,
      phaseId: undefined,
      priority: "high",
      sessionId: undefined,
      source: "manual",
      status: "in_progress",
      updatedAt: undefined,
    });
  });

  test("extractTodosFromMessages 提取 ultra phases tree 的 parentId 和 phaseId", () => {
    const messages: ChatMessage[] = [
      {
        content: "",
        id: "msg_ultra",
        parts: [
          {
            output: JSON.stringify({
              phases: [
                {
                  id: "phase_1",
                  items: [
                    {
                      content: "父任务",
                      id: "parent",
                      status: "pending",
                      subtasks: [
                        {
                          content: "子任务",
                          id: "child",
                          parentId: "parent",
                          status: "completed",
                        },
                      ],
                    },
                  ],
                  title: "阶段1",
                },
              ],
            }),
            status: "done",
            success: true,
            tool: "todo-ultra",
            type: "tool",
          },
        ],
        role: "assistant",
      },
    ];

    const todos = extractTodosFromMessages(messages, "ses_ultra");
    expect(
      todos.map((todo) => ({
        id: todo.id,
        parentId: todo.parentId,
        phaseId: todo.phaseId,
      })),
    ).toEqual([
      { id: "parent", parentId: undefined, phaseId: "phase_1" },
      { id: "child", parentId: "parent", phaseId: "phase_1" },
    ]);
  });

  test("extractTodosFromMessages 从 todo 工具 metadata 和 output 提取列表", () => {
    const messages: ChatMessage[] = [
      {
        content: "",
        id: "msg_1",
        parts: [
          {
            metadata: {
              todos: [{ content: "metadata todo", id: "todo_a", status: "pending" }],
            },
            output: JSON.stringify({
              items: [{ content: "output todo", id: "todo_b", status: "completed" }],
            }),
            status: "done",
            success: true,
            tool: "todo-ultra",
            type: "tool",
          },
        ],
        role: "assistant",
      },
    ];

    expect(
      extractTodosFromMessages(messages, "ses_test").map((todo) => ({
        content: todo.content,
        id: todo.id,
        sessionId: todo.sessionId,
        status: todo.status,
      })),
    ).toEqual([
      { content: "metadata todo", id: "todo_a", sessionId: "ses_test", status: "pending" },
      { content: "output todo", id: "todo_b", sessionId: "ses_test", status: "completed" },
    ]);
  });

  test("sortSessionTodos 与 summarizeTodos 对齐 opencode Todo Slot 展示规则", () => {
    const sorted = sortSessionTodos([
      { content: "done", id: "done", source: "manual", status: "completed" },
      { content: "low", id: "low", priority: "low", source: "manual", status: "pending" },
      { content: "run", id: "run", source: "manual", status: "in_progress" },
      { content: "high", id: "high", priority: "high", source: "manual", status: "pending" },
    ]);
    expect(sorted.map((todo) => todo.id)).toEqual(["run", "high", "low", "done"]);
    expect(summarizeTodos(sorted)).toEqual({
      active: 3,
      completed: 1,
      inProgress: 1,
      pending: 2,
      total: 4,
    });
  });

  test("buildModifiedFilesFromMessages 聚合工具 diff 作为 Sidebar Files slot 数据", () => {
    const diff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1 +1 @@",
      "-const a = 1;",
      "+const a = 2;",
      "diff --git a/src/b.ts b/src/b.ts",
      "--- a/src/b.ts",
      "+++ b/src/b.ts",
      "@@ -0,0 +1 @@",
      "+export const b = true;",
    ].join("\n");
    const messages: ChatMessage[] = [
      {
        content: "",
        id: "msg_diff",
        parts: [
          {
            metadata: { diff },
            status: "done",
            success: true,
            tool: "edit",
            type: "tool",
          },
        ],
        role: "assistant",
      },
    ];

    expect(buildModifiedFilesFromMessages(messages)).toEqual([
      { additions: 1, deletions: 1, file: "src/a.ts" },
      { additions: 1, deletions: 0, file: "src/b.ts" },
    ]);
  });

  test("Getting started card 仅在没有可用 provider 时提示配置", () => {
    expect(
      shouldShowGettingStartedCard({
        defaultProvider: { model: "gpt-4o", provider: "openai" },
        providerConfig: {},
      } as any),
    ).toBe(true);

    expect(
      shouldShowGettingStartedCard({
        defaultProvider: { model: "gpt-4o", provider: "openai" },
        providerConfig: {
          openai: { apiKey: "sk-test", requestMethod: "chat" },
        },
      } as any),
    ).toBe(false);

    expect(
      shouldShowGettingStartedCard({
        defaultProvider: { model: "llama3.1", provider: "ollama" },
        providerConfig: {
          ollama: { baseURL: "http://localhost:11434", requestMethod: "chat" },
        },
      } as any),
    ).toBe(false);
  });

  test("Session 源连接 sidebar_content, Todo Slot, 与 TodoListPanel", () => {
    const sidebarSource = fs.readFileSync(
      path.join(process.cwd(), "src/ui/pages/session/components/sidebar.tsx"),
      "utf8",
    );
    const sessionSource = fs.readFileSync(path.join(process.cwd(), "src/ui/pages/session/index.tsx"), "utf8");
    const overlaysSource = fs.readFileSync(
      path.join(process.cwd(), "src/ui/pages/session/panels/SessionOverlays.tsx"),
      "utf8",
    );
    const eventHandlersSource = fs.readFileSync(
      path.join(process.cwd(), "src/ui/pages/session/sessionEventHandlers.ts"),
      "utf8",
    );

    expect(sidebarSource).toContain('SidebarSlot name="sidebar_content"');
    expect(sidebarSource).toContain('SidebarSlot name="sidebar_footer"');
    expect(sidebarSource).toContain("SidebarMcpSlot");
    expect(sidebarSource).toContain("SidebarLspSlot");
    expect(sidebarSource).toContain("SidebarTodoSlot");
    expect(sidebarSource).toContain("SidebarFilesSlot");
    expect(sidebarSource).toContain("已修改文件");
    expect(sidebarSource).toContain("开始使用");
    expect(sidebarSource).toContain("配置 Provider");
    expect(sidebarSource).toContain("/settings");
    expect(sidebarSource).toContain("props.count > 2");
    expect(sidebarSource).toContain("todoDepth(todo, sorted())");
    expect(sidebarSource).toContain("todoColor(todo.status, props.colors)");
    expect(sidebarSource).toContain('wrapMode="word"');
    expect(sidebarSource).toContain("个进行中 / 共");
    expect(eventHandlersSource).toContain("AppEvent.TodoSync");
    expect(eventHandlersSource).toContain("setSyncedTodos");
    expect(sessionSource).toContain("extractTodosFromMessages");
    expect(sessionSource).toContain("extended={theme.extended}");
    expect(sessionSource).toContain("config={props.config}");
    expect(overlaysSource).toContain("TodoListPanel");
    expect(overlaysSource).toContain("todoPanelItems");
    expect(overlaysSource).toContain("setShowTodoList(false)");
  });
});
