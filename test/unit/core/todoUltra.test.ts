/**
 * [测试目标] P1-2 Ultra Todo 子任务闭环。
 *
 * 测试目标:
 *   - 验证 todoUltraTool 在 create / update / split / merge / sync 等动作下与 bus、CollaborationManager 协同工作
 *
 * 测试用例:
 *   - mock @core/logger / @bus/eventBus / @bus/events / @server/collaboration 后覆盖 ultra 各 action 路径
 *   - 断言 todos.json 落盘结构、phase 关系、子任务完成回填主任务等行为
 */
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { globalBus } from "@/bus";

describe("P1-2: Ultra Todo 子任务闭环", () => {
  const tmpDir = path.join(process.cwd(), ".test-todo-ultra");
  const crabDir = path.join(tmpDir, ".crab");

  beforeEach(() => {
    mock.restore();
    rmSync(tmpDir, { force: true, recursive: true });
    mkdirSync(crabDir, { recursive: true });
    spyOn(globalBus, "publish").mockImplementation(() => {});
    spyOn(globalBus, "subscribe").mockImplementation(() => () => {});
  });

  afterEach(() => {
    mock.restore();
  });

  function mockModules() {
    mock.module("@/core/logging/logger", () => ({
      createLogger: () => ({ debug: () => {}, error: () => {}, info: () => {}, warn: () => {} }),
    }));
    mock.module("@/server/collaboration", () => ({
      CollaborationManager: class {
        broadcastToRoom() {}
        dispose() {}
      },
      collaborationManager: { broadcastToRoom() {}, dispose() {} },
    }));
  }

  function writeTodos(data: Record<string, unknown>) {
    writeFileSync(path.join(crabDir, "todos.json"), JSON.stringify(data, null, 2), "utf8");
  }

  function readTodos(): any {
    try {
      return JSON.parse(readFileSync(path.join(crabDir, "todos.json"), "utf8"));
    } catch {
      return null;
    }
  }

  async function loadMod() {
    return import("@/tool/todo/index.ts");
  }

  // ── add_subtask ──────────────────────────────────────────────
  describe("add_subtask", () => {
    test("子任务继承父任务的 phaseId", async () => {
      mockModules();
      writeTodos({
        currentPhaseId: "p1",
        items: [],
        phases: [{ createdAt: "2026-01-01", id: "p1", status: "inProgress", title: "阶段1", updatedAt: "2026-01-01" }],
        ultraMode: true,
        updatedAt: new Date().toISOString(),
      });

      const mod = await loadMod();
      await mod.todoUltraTool.execute({ action: "add_item", content: "父任务", projectDir: tmpDir });
      const parent = readTodos();
      const parentId = parent.items[0].id;

      const result = (await mod.todoUltraTool.execute({
        action: "add_subtask",
        content: "子任务A",
        id: parentId,
        projectDir: tmpDir,
      })) as { success: boolean; item: { parentId: string; phaseId: string } };
      expect(result.success).toBe(true);
      expect(result.item.parentId).toBe(parentId);
      expect(result.item.phaseId).toBe("p1");
    });

    test("拒绝无效的 parentId", async () => {
      mockModules();
      writeTodos({
        currentPhaseId: "p1",
        items: [],
        phases: [{ createdAt: "2026-01-01", id: "p1", status: "pending", title: "阶段1", updatedAt: "2026-01-01" }],
        ultraMode: true,
        updatedAt: new Date().toISOString(),
      });

      const mod = await loadMod();
      const result = (await mod.todoUltraTool.execute({
        action: "add_subtask",
        content: "子任务",
        id: "invalid_id",
        projectDir: tmpDir,
      })) as { success: boolean; error: string };
      expect(result.success).toBe(false);
      expect(result.error).toContain("父任务不存在");
    });

    test("支持 priority 参数", async () => {
      mockModules();
      writeTodos({
        currentPhaseId: "p1",
        items: [],
        phases: [{ createdAt: "2026-01-01", id: "p1", status: "inProgress", title: "阶段1", updatedAt: "2026-01-01" }],
        ultraMode: true,
        updatedAt: new Date().toISOString(),
      });

      const mod = await loadMod();
      await mod.todoUltraTool.execute({ action: "add_item", content: "父任务", projectDir: tmpDir });
      const parentId = readTodos().items[0].id;

      const result = (await mod.todoUltraTool.execute({
        action: "add_subtask",
        content: "高优子任务",
        id: parentId,
        priority: "high",
        projectDir: tmpDir,
      })) as { success: boolean; item: { priority: string } };
      expect(result.success).toBe(true);
      expect(result.item.priority).toBe("high");
    });

    test("不传 priority 时 priority 为 undefined", async () => {
      mockModules();
      writeTodos({
        currentPhaseId: "p1",
        items: [],
        phases: [{ createdAt: "2026-01-01", id: "p1", status: "inProgress", title: "阶段1", updatedAt: "2026-01-01" }],
        ultraMode: true,
        updatedAt: new Date().toISOString(),
      });

      const mod = await loadMod();
      await mod.todoUltraTool.execute({ action: "add_item", content: "父任务", projectDir: tmpDir });
      const parentId = readTodos().items[0].id;

      const result = (await mod.todoUltraTool.execute({
        action: "add_subtask",
        content: "普通子任务",
        id: parentId,
        projectDir: tmpDir,
      })) as { success: boolean; item: { priority?: string } };
      expect(result.success).toBe(true);
      expect(result.item.priority).toBeUndefined();
    });
  });

  // ── add_item with priority ────────────────────────────────────
  describe("add_item 带优先级", () => {
    test("带 priority 创建任务", async () => {
      mockModules();
      writeTodos({
        currentPhaseId: "p1",
        items: [],
        phases: [{ createdAt: "2026-01-01", id: "p1", status: "inProgress", title: "阶段1", updatedAt: "2026-01-01" }],
        ultraMode: true,
        updatedAt: new Date().toISOString(),
      });

      const mod = await loadMod();
      const result = (await mod.todoUltraTool.execute({
        action: "add_item",
        content: "高优任务",
        priority: "high",
        projectDir: tmpDir,
      })) as { success: boolean; item: { priority: string } };
      expect(result.success).toBe(true);
      expect(result.item.priority).toBe("high");
    });

    test("不带 priority 创建任务", async () => {
      mockModules();
      writeTodos({
        currentPhaseId: "p1",
        items: [],
        phases: [{ createdAt: "2026-01-01", id: "p1", status: "inProgress", title: "阶段1", updatedAt: "2026-01-01" }],
        ultraMode: true,
        updatedAt: new Date().toISOString(),
      });

      const mod = await loadMod();
      const result = (await mod.todoUltraTool.execute({
        action: "add_item",
        content: "普通任务",
        projectDir: tmpDir,
      })) as { success: boolean; item: { priority?: string } };
      expect(result.success).toBe(true);
      expect(result.item.priority).toBeUndefined();
    });
  });

  // ── delete_item 级联删除 ───────────────────────────────────────
  describe("delete_item 级联删除", () => {
    test("删除父任务时级联删除子任务", async () => {
      mockModules();
      const now = new Date().toISOString();
      writeTodos({
        currentPhaseId: "p1",
        items: [
          { content: "父任务", createdAt: now, id: "parent1", phaseId: "p1", status: "pending", updatedAt: now },
          {
            content: "子任务A",
            createdAt: now,
            id: "sub1",
            parentId: "parent1",
            phaseId: "p1",
            status: "pending",
            updatedAt: now,
          },
          {
            content: "子任务B",
            createdAt: now,
            id: "sub2",
            parentId: "parent1",
            phaseId: "p1",
            status: "pending",
            updatedAt: now,
          },
        ],
        phases: [{ createdAt: now, id: "p1", status: "inProgress", title: "阶段1", updatedAt: now }],
        ultraMode: true,
        updatedAt: now,
      });

      const mod = await loadMod();
      const result = (await mod.todoUltraTool.execute({
        action: "delete_item",
        id: "parent1",
        projectDir: tmpDir,
      })) as { success: boolean; cascadedCount: number };
      expect(result.success).toBe(true);
      expect(result.cascadedCount).toBe(2);

      const store = readTodos();
      expect(store.items.length).toBe(0);
    });

    test("删除叶子节点 cascadedCount=0", async () => {
      mockModules();
      const now = new Date().toISOString();
      writeTodos({
        currentPhaseId: "p1",
        items: [{ content: "叶子任务", createdAt: now, id: "leaf1", phaseId: "p1", status: "pending", updatedAt: now }],
        phases: [{ createdAt: now, id: "p1", status: "inProgress", title: "阶段1", updatedAt: now }],
        ultraMode: true,
        updatedAt: now,
      });

      const mod = await loadMod();
      const result = (await mod.todoUltraTool.execute({ action: "delete_item", id: "leaf1", projectDir: tmpDir })) as {
        success: boolean;
        cascadedCount: number;
      };
      expect(result.success).toBe(true);
      expect(result.cascadedCount).toBe(0);
    });

    test("删除嵌套子任务级联删除所有后代", async () => {
      mockModules();
      const now = new Date().toISOString();
      writeTodos({
        currentPhaseId: "p1",
        items: [
          { content: "L1", createdAt: now, id: "l1", phaseId: "p1", status: "pending", updatedAt: now },
          { content: "L2", createdAt: now, id: "l2", parentId: "l1", phaseId: "p1", status: "pending", updatedAt: now },
          {
            content: "L3-a",
            createdAt: now,
            id: "l3a",
            parentId: "l2",
            phaseId: "p1",
            status: "pending",
            updatedAt: now,
          },
          {
            content: "L3-b",
            createdAt: now,
            id: "l3b",
            parentId: "l2",
            phaseId: "p1",
            status: "pending",
            updatedAt: now,
          },
        ],
        phases: [{ createdAt: now, id: "p1", status: "inProgress", title: "阶段1", updatedAt: now }],
        ultraMode: true,
        updatedAt: now,
      });

      const mod = await loadMod();
      const result = (await mod.todoUltraTool.execute({ action: "delete_item", id: "l1", projectDir: tmpDir })) as {
        success: boolean;
        cascadedCount: number;
      };
      expect(result.success).toBe(true);
      expect(result.cascadedCount).toBe(3);
      expect(readTodos().items.length).toBe(0);
    });
  });

  // ── complete_phase 子任务检查 ────────────────────────────────
  describe("complete_phase 子任务检查", () => {
    test("update_item 阻止父任务在子孙任务未完成时直接完成", async () => {
      mockModules();
      const now = new Date().toISOString();
      writeTodos({
        currentPhaseId: "p1",
        items: [
          { content: "父任务", createdAt: now, id: "parent1", phaseId: "p1", status: "pending", updatedAt: now },
          {
            content: "子任务",
            createdAt: now,
            id: "sub1",
            parentId: "parent1",
            phaseId: "p1",
            status: "pending",
            updatedAt: now,
          },
          {
            content: "孙任务",
            createdAt: now,
            id: "grand1",
            parentId: "sub1",
            phaseId: "p1",
            status: "pending",
            updatedAt: now,
          },
        ],
        phases: [{ createdAt: now, id: "p1", status: "inProgress", title: "阶段1", updatedAt: now }],
        ultraMode: true,
        updatedAt: now,
      });

      const mod = await loadMod();
      const blocked = (await mod.todoUltraTool.execute({
        action: "update_item",
        id: "parent1",
        projectDir: tmpDir,
        status: "completed",
      })) as { success: boolean; incompleteItems: { id: string }[] };
      expect(blocked.success).toBe(false);
      expect(blocked.incompleteItems.map((item: any) => item.id).toSorted()).toEqual(["grand1", "sub1"]);

      await mod.todoUltraTool.execute({ action: "update_item", id: "grand1", projectDir: tmpDir, status: "completed" });
      await mod.todoUltraTool.execute({ action: "update_item", id: "sub1", projectDir: tmpDir, status: "completed" });
      const completed = (await mod.todoUltraTool.execute({
        action: "update_item",
        id: "parent1",
        projectDir: tmpDir,
        status: "completed",
      })) as { success: boolean; item: { status: string } };
      expect(completed.success).toBe(true);
      expect(completed.item.status).toBe("completed");
    });

    test("子任务未完成时阻塞 complete_phase", async () => {
      mockModules();
      const now = new Date().toISOString();
      writeTodos({
        currentPhaseId: "p1",
        items: [
          { content: "父任务", createdAt: now, id: "parent1", phaseId: "p1", status: "completed", updatedAt: now },
          {
            content: "未完成子任务",
            createdAt: now,
            id: "sub1",
            parentId: "parent1",
            phaseId: "p1",
            status: "pending",
            updatedAt: now,
          },
        ],
        phases: [{ createdAt: now, id: "p1", status: "inProgress", title: "阶段1", updatedAt: now }],
        ultraMode: true,
        updatedAt: now,
      });

      const mod = await loadMod();
      const result = (await mod.todoUltraTool.execute({ action: "complete_phase", projectDir: tmpDir })) as {
        success: boolean;
        error: string;
      };
      expect(result.success).toBe(false);
      expect(result.error).toContain("未完成子任务");
    });

    test("子任务全部完成时通过 complete_phase", async () => {
      mockModules();
      const now = new Date().toISOString();
      writeTodos({
        currentPhaseId: "p1",
        items: [
          { content: "父任务", createdAt: now, id: "parent1", phaseId: "p1", status: "completed", updatedAt: now },
          {
            content: "子任务",
            createdAt: now,
            id: "sub1",
            parentId: "parent1",
            phaseId: "p1",
            status: "completed",
            updatedAt: now,
          },
        ],
        phases: [{ createdAt: now, id: "p1", status: "inProgress", title: "阶段1", updatedAt: now }],
        ultraMode: true,
        updatedAt: now,
      });

      const mod = await loadMod();
      const result = (await mod.todoUltraTool.execute({ action: "complete_phase", projectDir: tmpDir })) as {
        success: boolean;
        phase: { status: string };
      };
      expect(result.success).toBe(true);
      expect(result.phase.status).toBe("completed");
    });

    test("无子任务时正常通过 complete_phase", async () => {
      mockModules();
      const now = new Date().toISOString();
      writeTodos({
        currentPhaseId: "p1",
        items: [{ content: "任务", createdAt: now, id: "task1", phaseId: "p1", status: "completed", updatedAt: now }],
        phases: [{ createdAt: now, id: "p1", status: "inProgress", title: "阶段1", updatedAt: now }],
        ultraMode: true,
        updatedAt: now,
      });

      const mod = await loadMod();
      const result = (await mod.todoUltraTool.execute({ action: "complete_phase", projectDir: tmpDir })) as {
        success: boolean;
      };
      expect(result.success).toBe(true);
    });
  });

  // ── ultraGet tree 结构 ────────────────────────────────────────
  describe("ultraGet tree 结构", () => {
    test("返回 tree 结构含 subtasks 数组", async () => {
      mockModules();
      const now = new Date().toISOString();
      writeTodos({
        currentPhaseId: "p1",
        items: [
          { content: "父任务", createdAt: now, id: "parent1", phaseId: "p1", status: "pending", updatedAt: now },
          {
            content: "子任务A",
            createdAt: now,
            id: "sub1",
            parentId: "parent1",
            phaseId: "p1",
            status: "pending",
            updatedAt: now,
          },
          {
            content: "子任务B",
            createdAt: now,
            id: "sub2",
            parentId: "parent1",
            phaseId: "p1",
            status: "pending",
            updatedAt: now,
          },
        ],
        phases: [{ createdAt: now, id: "p1", status: "inProgress", title: "阶段1", updatedAt: now }],
        ultraMode: true,
        updatedAt: now,
      });

      const mod = await loadMod();
      const result = (await mod.todoUltraTool.execute({ action: "get", projectDir: tmpDir })) as any;
      expect(result.success).toBe(true);

      const phaseData = result.phases[0] as any;
      expect(phaseData.items.length).toBe(1);
      expect(phaseData.items[0].subtasks.length).toBe(2);
      expect(phaseData.items[0].subtasks[0].parentId).toBe("parent1");
    });

    test("返回 tree 结构递归包含孙任务", async () => {
      mockModules();
      const now = new Date().toISOString();
      writeTodos({
        currentPhaseId: "p1",
        items: [
          { content: "父任务", createdAt: now, id: "parent1", phaseId: "p1", status: "pending", updatedAt: now },
          {
            content: "子任务A",
            createdAt: now,
            id: "sub1",
            parentId: "parent1",
            phaseId: "p1",
            status: "pending",
            updatedAt: now,
          },
          {
            content: "孙任务A",
            createdAt: now,
            id: "grand1",
            parentId: "sub1",
            phaseId: "p1",
            status: "pending",
            updatedAt: now,
          },
        ],
        phases: [{ createdAt: now, id: "p1", status: "inProgress", title: "阶段1", updatedAt: now }],
        ultraMode: true,
        updatedAt: now,
      });

      const mod = await loadMod();
      const result = (await mod.todoUltraTool.execute({ action: "get", projectDir: tmpDir })) as any;
      expect(result.success).toBe(true);

      const phaseData = result.phases[0] as any;
      expect(phaseData.items).toHaveLength(1);
      expect(phaseData.items[0].subtasks).toHaveLength(1);
      expect(phaseData.items[0].subtasks[0].subtasks).toHaveLength(1);
      expect(phaseData.items[0].subtasks[0].subtasks[0].content).toBe("孙任务A");
      expect(result.content).toContain("↳ 孙任务A");
    });

    test("文本输出包含缩进子任务", async () => {
      mockModules();
      const now = new Date().toISOString();
      writeTodos({
        currentPhaseId: "p1",
        items: [
          { content: "父任务", createdAt: now, id: "parent1", phaseId: "p1", status: "pending", updatedAt: now },
          {
            content: "子任务A",
            createdAt: now,
            id: "sub1",
            parentId: "parent1",
            phaseId: "p1",
            status: "pending",
            updatedAt: now,
          },
        ],
        phases: [{ createdAt: now, id: "p1", status: "inProgress", title: "阶段1", updatedAt: now }],
        ultraMode: true,
        updatedAt: now,
      });

      const mod = await loadMod();
      const result = (await mod.todoUltraTool.execute({ action: "get", projectDir: tmpDir })) as { content: string };
      expect(result.content).toContain("↳ 子任务A");

      const lines = result.content.split("\n");
      const parentLine = lines.find((l: string) => l.includes("父任务") && l.includes("parent1"))!;
      const subLine = lines.find((l: string) => l.includes("↳ 子任务A"))!;
      // 子任务缩进更深
      expect(subLine.length - subLine.trimStart().length).toBeGreaterThan(
        parentLine.length - parentLine.trimStart().length,
      );
    });
  });

  // ── advance_phase force 跳过子任务检查 ──────────────────────
  describe("advance_phase force", () => {
    test("force 跳过子任务未完成检查", async () => {
      mockModules();
      const now = new Date().toISOString();
      writeTodos({
        currentPhaseId: "p1",
        items: [
          { content: "父任务", createdAt: now, id: "parent1", phaseId: "p1", status: "pending", updatedAt: now },
          {
            content: "未完成子任务",
            createdAt: now,
            id: "sub1",
            parentId: "parent1",
            phaseId: "p1",
            status: "pending",
            updatedAt: now,
          },
        ],
        phases: [
          { createdAt: now, id: "p1", status: "inProgress", title: "阶段1", updatedAt: now },
          { createdAt: now, id: "p2", status: "pending", title: "阶段2", updatedAt: now },
        ],
        ultraMode: true,
        updatedAt: now,
      });

      const mod = await loadMod();
      const result = (await mod.todoUltraTool.execute({
        action: "advance_phase",
        force: true,
        projectDir: tmpDir,
      })) as { success: boolean; currentPhaseId: string };
      expect(result.success).toBe(true);
      expect(result.currentPhaseId).toBe("p2");
    });
  });
});
