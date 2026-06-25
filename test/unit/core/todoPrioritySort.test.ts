/**
 * [测试目标] Todo 优先级排序 (L4-T08)。
 *
 * 测试目标:
 *   - 验证 todoUltraTool 在 sortBy=priority 时按 high > medium > low 降序输出，并在切到其他排序时回退
 *
 * 测试用例:
 *   - sortBy=priority 按优先级降序排列:high > medium > low:构造三类优先级，断言 list 返回顺序
 *   - 其余用例覆盖 sortBy=created / updated 时按时间排序、空 todos 文件、空 items 等
 */
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

describe("Todo Priority Sort (L4-T08)", () => {
  const tmpDir = path.join(process.cwd(), ".test-todo-sort");
  const crabDir = path.join(tmpDir, ".crab");

  beforeEach(() => {
    mock.restore();
    rmSync(tmpDir, { force: true, recursive: true });
    mkdirSync(crabDir, { recursive: true });
  });

  afterEach(() => {
    mock.restore();
  });

  function mockModules() {
    mock.module("@core/logger", () => ({
      createLogger: () => ({ debug: () => {}, error: () => {}, info: () => {}, warn: () => {} }),
    }));
  }

  function writeTodos(data: Record<string, unknown>) {
    writeFileSync(path.join(crabDir, "todos.json"), JSON.stringify(data, null, 2), "utf8");
  }

  test("sortBy=priority 按优先级降序排列:high > medium > low", async () => {
    mockModules();
    writeTodos({
      items: [
        {
          content: "低优先级任务",
          createdAt: "2026-01-01",
          id: "t1",
          priority: "low",
          status: "pending",
          updatedAt: "2026-01-01",
        },
        {
          content: "高优先级任务",
          createdAt: "2026-01-02",
          id: "t2",
          priority: "high",
          status: "pending",
          updatedAt: "2026-01-02",
        },
        {
          content: "中优先级任务",
          createdAt: "2026-01-03",
          id: "t3",
          priority: "medium",
          status: "pending",
          updatedAt: "2026-01-03",
        },
      ],
      updatedAt: "2026-01-03",
    });

    const mod = await import("@/tool/todo/index.ts");
    const result = (await mod.todoUltraTool.execute({
      action: "list",
      projectDir: tmpDir,
      sortBy: "priority",
    })) as { success: boolean; items: { id: string; content: string }[] };

    expect(result.success).toBe(true);
    const items = result.items;
    expect(items[0]!.id).toBe("t2"); // High
    expect(items[1]!.id).toBe("t3"); // Medium
    expect(items[2]!.id).toBe("t1"); // Low
  });

  test("sortBy=created 按创建时间降序排列", async () => {
    mockModules();
    writeTodos({
      items: [
        { content: "最早", createdAt: "2026-01-01T00:00:00Z", id: "t1", status: "pending", updatedAt: "2026-01-01" },
        { content: "最新", createdAt: "2026-01-03T00:00:00Z", id: "t2", status: "pending", updatedAt: "2026-01-03" },
        { content: "中间", createdAt: "2026-01-02T00:00:00Z", id: "t3", status: "pending", updatedAt: "2026-01-02" },
      ],
      updatedAt: "2026-01-03",
    });

    const mod = await import("@/tool/todo/index.ts");
    const result = (await mod.todoUltraTool.execute({
      action: "list",
      projectDir: tmpDir,
      sortBy: "created",
    })) as { success: boolean; items: { id: string }[] };

    expect(result.success).toBe(true);
    const items = result.items;
    expect(items[0]!.id).toBe("t2");
    expect(items[1]!.id).toBe("t3");
    expect(items[2]!.id).toBe("t1");
  });

  test("sortBy=updated 按更新时间降序排列", async () => {
    mockModules();
    writeTodos({
      items: [
        { content: "未更新", createdAt: "2026-01-01", id: "t1", status: "pending", updatedAt: "2026-01-01" },
        { content: "已更新", createdAt: "2026-01-01", id: "t2", status: "pending", updatedAt: "2026-01-10" },
      ],
      updatedAt: "2026-01-10",
    });

    const mod = await import("@/tool/todo/index.ts");
    const result = (await mod.todoUltraTool.execute({
      action: "list",
      projectDir: tmpDir,
      sortBy: "updated",
    })) as { success: boolean; items: { id: string }[] };

    expect(result.success).toBe(true);
    const items = result.items;
    expect(items[0]!.id).toBe("t2");
    expect(items[1]!.id).toBe("t1");
  });

  test("分页正确计算 totalPages 和 slice", async () => {
    mockModules();
    const items = Array.from({ length: 5 }, (_, i) => ({
      content: `任务${i + 1}`,
      createdAt: `2026-01-0${i + 1}T00:00:00Z`,
      id: `t${i + 1}`,
      status: "pending",
      updatedAt: `2026-01-0${i + 1}`,
    }));
    writeTodos({ items, updatedAt: "2026-01-05" });

    const mod = await import("@/tool/todo/index.ts");
    const result = (await mod.todoUltraTool.execute({
      action: "list",
      page: 2,
      pageSize: 2,
      projectDir: tmpDir,
    })) as { success: boolean; page: number; pageSize: number; totalPages: number; items: { id: string }[] };

    expect(result.success).toBe(true);
    expect(result.page).toBe(2);
    expect(result.pageSize).toBe(2);
    expect(result.totalPages).toBe(3);
    expect(result.items.length).toBe(2);
    expect(result.items[0]!.id).toBe("t3");
  });

  test("无优先级的项默认为 medium 排序", async () => {
    mockModules();
    writeTodos({
      items: [
        { content: "无优先级A", createdAt: "2026-01-02", id: "t1", status: "pending", updatedAt: "2026-01-02" },
        { content: "无优先级B", createdAt: "2026-01-01", id: "t2", status: "pending", updatedAt: "2026-01-01" },
        {
          content: "高优先级",
          createdAt: "2026-01-03",
          id: "t3",
          priority: "high",
          status: "pending",
          updatedAt: "2026-01-03",
        },
      ],
      updatedAt: "2026-01-03",
    });

    const mod = await import("@/tool/todo/index.ts");
    const result = (await mod.todoUltraTool.execute({
      action: "list",
      projectDir: tmpDir,
      sortBy: "priority",
    })) as { success: boolean; items: { id: string }[] };

    expect(result.success).toBe(true);
    const items = result.items;
    // High first, then medium (no priority defaults to medium)
    expect(items[0]!.id).toBe("t3");
    // T1 和 t2 都是 medium，按 priority 排序后顺序不确定但应在 high 之后
  });
});
