/**
 * 待办事项工具测试。
 *
 * 测试用例:
 *   - 待办创建
 *   - 待办更新
 *   - 待办查询
 *   - 待办完成
 */
import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { todoUltraTool } from "@/tool/todo";
import { askUserQuestionTool } from "@/tool/askUser";
import { schedulerTool } from "@/tool/scheduler";
import { notebookTool } from "@/tool/notebook";

// ─── TODO ────────────────────────────────────────────────────────

describe("待办", () => {
  test("创建 TODO 项", async () => {
    const result = (await todoUltraTool.execute({
      action: "create",
      content: "实现用户认证模块",
      priority: "high",
    })) as any;

    expect(result.success).toBe(true);
    expect(result.item.content).toBe("实现用户认证模块");
    expect(result.item.status).toBe("pending");
    expect(result.item.priority).toBe("high");
    expect(result.item.id).toMatch(/^todo_/);
  });

  test("创建 TODO 缺少 content 返回错误", async () => {
    const result = (await todoUltraTool.execute({ action: "create" })) as any;
    expect(result.success).toBe(false);
    expect(result.error).toContain("content");
  });

  test("更新 TODO 状态", async () => {
    const createResult = (await todoUltraTool.execute({
      action: "create",
      content: "编写测试",
    })) as any;
    const { id } = createResult.item;

    const result = (await todoUltraTool.execute({
      action: "update",
      id,
      status: "in_progress",
    })) as any;

    expect(result.success).toBe(true);
    expect(result.item.status).toBe("in_progress");
  });

  test("状态完整流转:pending → in_progress → completed", async () => {
    const c1 = (await todoUltraTool.execute({ action: "create", content: "flow test" })) as any;
    const { id } = c1.item;

    const u1 = (await todoUltraTool.execute({ action: "update", id, status: "in_progress" })) as any;
    expect(u1.item.status).toBe("in_progress");

    const u2 = (await todoUltraTool.execute({ action: "update", id, status: "completed" })) as any;
    expect(u2.item.status).toBe("completed");
  });

  test("列出所有 TODO", async () => {
    await todoUltraTool.execute({ action: "create", content: "任务 A" });
    await todoUltraTool.execute({ action: "create", content: "任务 B" });

    const result = (await todoUltraTool.execute({ action: "list" })) as any;

    expect(result.success).toBe(true);
    expect(result.total).toBeGreaterThanOrEqual(2);
    expect(result.content).toContain("任务 A");
    expect(result.content).toContain("任务 B");
  });

  test("读取指定 TODO", async () => {
    const c = (await todoUltraTool.execute({ action: "create", content: "read me" })) as any;
    const result = (await todoUltraTool.execute({ action: "read", id: c.item.id })) as any;
    expect(result.success).toBe(true);
    expect(result.item.content).toBe("read me");
  });

  test("删除 TODO", async () => {
    const c = (await todoUltraTool.execute({ action: "create", content: "delete me" })) as any;
    const result = (await todoUltraTool.execute({ action: "delete", id: c.item.id })) as any;
    expect(result.success).toBe(true);
    expect(result.item.content).toBe("delete me");
  });

  test("创建子任务并按 parentId 过滤", async () => {
    const parent = (await todoUltraTool.execute({ action: "create", content: "父任务" })) as any;
    const child = (await todoUltraTool.execute({
      action: "create",
      content: "子任务",
      parentId: parent.item.id,
    })) as any;

    expect(child.success).toBe(true);
    expect(child.item.parentId).toBe(parent.item.id);

    const list = (await todoUltraTool.execute({ action: "list", parentId: parent.item.id })) as any;
    expect(list.success).toBe(true);
    expect(list.items.map((item: any) => item.id)).toContain(child.item.id);
    expect(list.items.every((item: any) => item.parentId === parent.item.id)).toBe(true);
  });

  test("删除有子任务的父任务默认阻止，显式 deleteChildren 才级联", async () => {
    const parent = (await todoUltraTool.execute({ action: "create", content: "父任务删除约束" })) as any;
    const child = (await todoUltraTool.execute({
      action: "create",
      content: "子任务删除约束",
      parentId: parent.item.id,
    })) as any;

    const blocked = (await todoUltraTool.execute({ action: "delete", id: parent.item.id })) as any;
    expect(blocked.success).toBe(false);
    expect(blocked.error).toContain("子任务");

    const deleted = (await todoUltraTool.execute({
      action: "delete",
      deleteChildren: true,
      id: parent.item.id,
    })) as any;
    expect(deleted.success).toBe(true);
    expect(deleted.cascadedCount).toBe(1);

    const readChild = (await todoUltraTool.execute({ action: "read", id: child.item.id })) as any;
    expect(readChild.success).toBe(false);
  });

  test("父任务存在未完成子孙任务时阻止直接完成父任务", async () => {
    const parent = (await todoUltraTool.execute({ action: "create", content: "父任务完成门禁" })) as any;
    const child = (await todoUltraTool.execute({
      action: "create",
      content: "子任务完成门禁",
      parentId: parent.item.id,
    })) as any;
    const grandchild = (await todoUltraTool.execute({
      action: "create",
      content: "孙任务完成门禁",
      parentId: child.item.id,
    })) as any;

    const blocked = (await todoUltraTool.execute({ action: "update", id: parent.item.id, status: "completed" })) as any;
    expect(blocked.success).toBe(false);
    expect(blocked.incompleteItems.map((item: any) => item.id).toSorted()).toEqual(
      [child.item.id, grandchild.item.id].toSorted(),
    );

    await todoUltraTool.execute({ action: "update", id: grandchild.item.id, status: "completed" });
    await todoUltraTool.execute({ action: "update", id: child.item.id, status: "completed" });
    const completed = (await todoUltraTool.execute({
      action: "update",
      id: parent.item.id,
      status: "completed",
    })) as any;
    expect(completed.success).toBe(true);
    expect(completed.item.status).toBe("completed");
  });

  test("同一项目的并发持久化创建不会丢写或留下临时文件", async () => {
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "crab-todo-concurrent-"));
    try {
      const contents = Array.from({ length: 20 }, (_, index) => `并发任务 ${index}`);
      await Promise.all(contents.map((item) => todoUltraTool.execute({ action: "create", content: item, projectDir })));

      const todoPath = path.join(projectDir, ".crab", "todos.json");
      const store = JSON.parse(fs.readFileSync(todoPath, "utf8"));
      expect(store.items).toHaveLength(contents.length);
      expect(store.items.map((item: any) => item.content).toSorted()).toEqual(contents.toSorted());

      const leftovers = fs
        .readdirSync(path.dirname(todoPath))
        .filter((file) => file.includes(".tmp") || file.endsWith(".lock"));
      expect(leftovers).toEqual([]);
    } finally {
      fs.rmSync(projectDir, { force: true, recursive: true });
    }
  });

  test("操作不存在的 TODO 返回错误", async () => {
    const result = (await todoUltraTool.execute({
      action: "update",
      id: "todo_nonexistent",
      status: "completed",
    })) as any;
    expect(result.success).toBe(false);
    expect(result.error).toContain("不存在");
  });
});

// ─── ask-user ────────────────────────────────────────────────────

describe("ask-user", () => {
  test("工具结构完整", () => {
    expect(askUserQuestionTool.name).toBe("askuser-ask-question");
    expect(typeof askUserQuestionTool.execute).toBe("function");
  });

  test("参数 Schema 验证", () => {
    const schema = askUserQuestionTool.parameters;
    expect(schema.safeParse({ question: "确认？" }).success).toBe(true);
    expect(schema.safeParse({}).success).toBe(false);
    expect(
      schema.safeParse({
        multiSelect: false,
        options: [
          { label: "是", value: "yes" },
          { label: "否", value: "no" },
        ],
        question: "选择",
      }).success,
    ).toBe(true);
    expect(
      schema.safeParse({
        allowFreeInput: true,
        question: "迁移策略选择",
        steps: [
          {
            allowFreeInput: true,
            id: "strategy",
            options: [{ label: "完整重写", value: "rewrite" }],
            question: "采用哪种迁移策略？",
            title: "迁移策略选择",
          },
        ],
      }).success,
    ).toBe(true);
  });
});

// ─── scheduler ───────────────────────────────────────────────────

describe("调度器", () => {
  test("创建 cron 计划任务", async () => {
    const result = (await schedulerTool.execute({
      action: "create",
      cron: "0 9 * * *",
      description: "每天 9 点执行构建检查",
      prompt: "每日构建检查",
    })) as any;

    expect(result.success).toBe(true);
    expect(result.task.id).toMatch(/^sch_/);
    expect(result.task.schedule).toContain("cron");
  });

  test("创建延迟任务", async () => {
    const result = (await schedulerTool.execute({
      action: "create",
      delay: 300,
      prompt: "5 分钟后提醒",
    })) as any;

    expect(result.success).toBe(true);
    expect(result.task.schedule).toContain("delay");
  });

  test("创建任务缺少参数返回错误", async () => {
    const result = (await schedulerTool.execute({
      action: "create",
      prompt: "test",
    })) as any;

    expect(result.success).toBe(false);
    expect(result.error).toContain("cron");
  });

  test("列出所有任务", async () => {
    await schedulerTool.execute({ action: "create", delay: 60, prompt: "test" });
    const result = (await schedulerTool.execute({ action: "list" })) as any;
    expect(result.success).toBe(true);
    expect(result.total).toBeGreaterThanOrEqual(1);
  });

  test("暂停和恢复任务", async () => {
    const c = (await schedulerTool.execute({ action: "create", delay: 60, prompt: "test" })) as any;
    const { id } = c.task;

    const pause = (await schedulerTool.execute({ action: "pause", taskId: id })) as any;
    expect(pause.success).toBe(true);
    expect(pause.task.enabled).toBe(false);

    const resume = (await schedulerTool.execute({ action: "resume", taskId: id })) as any;
    expect(resume.success).toBe(true);
    expect(resume.task.enabled).toBe(true);
  });

  test("删除任务", async () => {
    const c = (await schedulerTool.execute({ action: "create", delay: 60, prompt: "del" })) as any;
    const result = (await schedulerTool.execute({ action: "delete", taskId: c.task.id })) as any;
    expect(result.success).toBe(true);
  });
});

// ─── notebook ────────────────────────────────────────────────────

describe("笔记本", () => {
  test("创建笔记", async () => {
    const result = (await notebookTool.execute({
      action: "create",
      content: "使用 RESTful 风格",
      tags: ["api", "design"],
      title: "API 设计",
    })) as any;

    expect(result.success).toBe(true);
    expect(result.entry.title).toBe("API 设计");
    expect(result.entry.tags).toEqual(["api", "design"]);
  });

  test("搜索笔记", async () => {
    await notebookTool.execute({ action: "create", content: "使用 SQLite", title: "数据库设计" });
    await notebookTool.execute({ action: "create", content: "使用 SolidJS", title: "前端架构" });

    const result = (await notebookTool.execute({ action: "search", query: "SQLite" })) as any;
    expect(result.success).toBe(true);
    expect(result.total).toBeGreaterThanOrEqual(1);
  });

  test("列出所有笔记", async () => {
    const result = (await notebookTool.execute({ action: "list" })) as any;
    expect(result.success).toBe(true);
    expect(Array.isArray(result.entries)).toBe(true);
  });

  test("更新笔记", async () => {
    const c = (await notebookTool.execute({
      action: "create",
      content: "旧内容",
      title: "旧标题",
    })) as any;

    const result = (await notebookTool.execute({
      action: "update",
      noteId: c.entry.id,
      title: "新标题",
    })) as any;

    expect(result.success).toBe(true);
    expect(result.entry.title).toBe("新标题");
  });

  test("删除笔记", async () => {
    const c = (await notebookTool.execute({ action: "create", title: "delete" })) as any;
    const result = (await notebookTool.execute({ action: "delete", noteId: c.entry.id })) as any;
    expect(result.success).toBe(true);
  });
});
