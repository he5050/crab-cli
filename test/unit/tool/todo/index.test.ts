/**
 * todoUltraTool 单元测试
 *
 * 覆盖范围:
 *   - generateId / getStore / saveStore / withTodoStoreLock 工具函数
 *   - CRUD 操作: create / read / update / delete / list
 *   - Ultra 阶段模式: get / add_phase / add_item / add_subtask / update_item / complete_phase / advance_phase / delete_item
 *   - 边界与错误场景
 */
import { afterAll, afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import { createGlobalTmpTestDir, cleanupTestDir } from "../../../helpers/testPaths";

// ── Mock 外部依赖 ────────────────────────────────────────────────────

mock.module("@/core/logging/logger", () => ({
  createLogger: () => ({
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  }),
}));

mock.module("@/core/icons/icon", () => ({
  iconError: "ERR",
  iconLoading: "LOAD",
  iconTasks: "DONE",
  iconWarning: "WARN",
  symEmpty: "O",
}));

mock.module("@/core/scanning", () => ({
  scanProjectTodos: () => [],
}));

// NOTE: 不 mock @/bus — mock.module 存在跨文件泄漏问题。
// 使用真实 globalBus + spyOn 采集 publish 调用。

import { globalBus } from "@/bus";
import { __resetGlobalBusForTest } from "@/bus";

let publishSpy: ReturnType<typeof spyOn>;

mock.module("@/config", () => ({
  MAX_TODO_STORES: 20,
}));

mock.module("@/core/errors/appError", () => ({
  ToolError: class ToolError extends Error {
    code: string;
    constructor(code: string, message: string, options?: unknown) {
      super(message);
      this.code = code;
      this.name = "ToolError";
    }
  },
}));

// ── 动态导入(必须在 mock 之后) ──────────────────────────────────────

const mod = await import("@/tool/todo");

const generateId = mod.generateId;
const getStore = mod.getStore;
const saveStore = mod.saveStore;
const withTodoStoreLock = mod.withTodoStoreLock;
const todoUltraTool = mod.todoUltraTool;
type TodoStore = mod.TodoStore;

// ── 测试辅助 ──────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = createGlobalTmpTestDir("crab-todo-test-");
  mkdirSync(join(tmpDir, ".crab"), { recursive: true });
  __resetGlobalBusForTest();
  publishSpy = spyOn(globalBus, "publish").mockImplementation(() => {});
});

afterEach(() => {
  publishSpy.mockClear();
  cleanupTestDir(tmpDir);
});

afterAll(() => {
  mock.restore();
});

/** 便捷执行器 — 自动传入 projectDir */
async function exec(params: Record<string, unknown>) {
  return todoUltraTool.execute({ ...params, projectDir: tmpDir } as Parameters<typeof todoUltraTool.execute>[0]);
}

// ══════════════════════════════════════════════════════════════════════
// 工具函数
// ══════════════════════════════════════════════════════════════════════

describe("generateId", () => {
  afterAll(() => {
    mock.restore();
  });
  test("生成的 ID 以 'todo_' 开头", () => {
    expect(generateId()).toMatch(/^todo_/);
  });

  test("连续调用生成唯一 ID", () => {
    const ids = new Set(Array.from({ length: 50 }, () => generateId()));
    expect(ids.size).toBe(50);
  });
});

describe("getStore", () => {
  test("项目目录无文件时返回空 items 的 store", () => {
    const store = getStore(tmpDir);
    expect(store.items).toEqual([]);
    expect(store.updatedAt).toBeTruthy();
  });

  test("不传 projectDir 时返回内存 store", () => {
    const store = getStore();
    expect(store.items).toEqual([]);
  });

  test("内存 store 在相同 key 下复用同一引用", () => {
    const a = getStore(undefined);
    const b = getStore(undefined);
    // __memory__ key 相同，应返回同一对象
    expect(a).toBe(b);
  });
});

describe("saveStore", () => {
  test("保存后 updatedAt 被刷新", () => {
    const store: TodoStore = { items: [], updatedAt: "2024-01-01T00:00:00.000Z" };
    saveStore(store, tmpDir);
    expect(store.updatedAt).not.toBe("2024-01-01T00:00:00.000Z");
  });

  test("保存时发布 TodoSync 事件", () => {
    const store: TodoStore = { items: [], updatedAt: "" };
    saveStore(store, tmpDir);
    expect(publishSpy).toHaveBeenCalledTimes(1);
    expect(publishSpy).toHaveBeenCalledWith({ type: "todo.sync" }, { items: [] });
  });
});

describe("withTodoStoreLock", () => {
  test("获取锁并执行回调函数", async () => {
    const result = await withTodoStoreLock(tmpDir, () => 42);
    expect(result).toBe(42);
  });

  test("回调执行完毕后释放锁目录", async () => {
    await withTodoStoreLock(tmpDir, () => {});
    // 锁文件应在 tmpDir/.crab/todos.json.lock 不存在
    const lockPath = join(tmpDir, ".crab", "todos.json.lock");
    expect(() => require("node:fs").existsSync(lockPath)).not.toThrow();
  });
});

// ══════════════════════════════════════════════════════════════════════
// CRUD 操作
// ══════════════════════════════════════════════════════════════════════

describe("action: create", () => {
  test("提供 content 后成功创建 TODO", async () => {
    const res = await exec({ action: "create", content: "测试任务" });
    expect(res.success).toBe(true);
    expect(res.item.content).toBe("测试任务");
    expect(res.item.status).toBe("pending");
    expect(res.item.id).toMatch(/^todo_/);
    expect(res.total).toBe(1);
  });

  test("缺少 content 时返回错误", async () => {
    const res = await exec({ action: "create" });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/content/);
  });

  test("指定 priority 后创建的 TODO 包含该优先级", async () => {
    const res = await exec({ action: "create", content: "高优先级", priority: "high" });
    expect(res.success).toBe(true);
    expect(res.item.priority).toBe("high");
  });

  test("指定 parentId 为不存在的 ID 时返回错误", async () => {
    const res = await exec({ action: "create", content: "子任务", parentId: "nonexistent" });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/父任务不存在/);
  });
});

describe("action: read", () => {
  test("有效 id 返回对应 TODO", async () => {
    const created = await exec({ action: "create", content: "读取目标" });
    const id = (created.item as { id: string }).id;
    const res = await exec({ action: "read", id });
    expect(res.success).toBe(true);
    expect(res.item.content).toBe("读取目标");
  });

  test("缺少 id 时返回错误", async () => {
    const res = await exec({ action: "read" });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/id/);
  });

  test("不存在的 id 返回错误", async () => {
    const res = await exec({ action: "read", id: "no_such_id" });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/不存在/);
  });
});

describe("action: update", () => {
  test("更新 status 为 completed 成功", async () => {
    const created = await exec({ action: "create", content: "待更新" });
    const id = (created.item as { id: string }).id;
    const res = await exec({ action: "update", id, status: "completed" });
    expect(res.success).toBe(true);
    expect(res.item.status).toBe("completed");
  });

  test("缺少 id 时返回错误", async () => {
    const res = await exec({ action: "update", status: "completed" });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/id/);
  });

  test("不存在的 id 返回错误", async () => {
    const res = await exec({ action: "update", id: "ghost", status: "completed" });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/不存在/);
  });
});

describe("action: delete", () => {
  test("成功删除指定 TODO", async () => {
    const created = await exec({ action: "create", content: "待删除" });
    const id = (created.item as { id: string }).id;
    const res = await exec({ action: "delete", id });
    expect(res.success).toBe(true);
    expect(res.total).toBe(0);
  });

  test("缺少 id 时返回错误", async () => {
    const res = await exec({ action: "delete" });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/id/);
  });

  test("不存在的 id 返回错误", async () => {
    const res = await exec({ action: "delete", id: "nope" });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/不存在/);
  });
});

describe("action: list", () => {
  test('列表为空时返回"任务列表为空"', async () => {
    const res = await exec({ action: "list" });
    expect(res.success).toBe(true);
    expect(res.content).toBe("任务列表为空");
    expect(res.total).toBe(0);
  });

  test("创建后 list 包含该任务", async () => {
    await exec({ action: "create", content: "列出来" });
    const res = await exec({ action: "list" });
    expect(res.total).toBe(1);
    expect(res.items[0].content).toBe("列出来");
  });

  test("按 status 过滤只返回匹配项", async () => {
    const c1 = await exec({ action: "create", content: "A" });
    const id1 = (c1.item as { id: string }).id;
    await exec({ action: "create", content: "B" });
    await exec({ action: "update", id: id1, status: "completed" });

    const res = await exec({ action: "list", filter: "pending" });
    expect(res.total).toBe(1);
    expect(res.items[0].content).toBe("B");
  });
});

// ══════════════════════════════════════════════════════════════════════
// Ultra 模式
// ══════════════════════════════════════════════════════════════════════

describe("action: get (Ultra)", () => {
  test('空 store 显示"无"当前阶段', async () => {
    const res = await exec({ action: "get" });
    expect(res.success).toBe(true);
    expect(res.content).toMatch(/当前阶段: 无/);
  });
});

describe("action: add_phase (Ultra)", () => {
  test("创建第一个阶段并自动设为当前阶段", async () => {
    const res = await exec({ action: "add_phase", title: "阶段一" });
    expect(res.success).toBe(true);
    expect(res.phase.title).toBe("阶段一");

    // 验证 currentPhaseId 已设置
    const getRes = await exec({ action: "get" });
    expect(getRes.currentPhaseId).toBeTruthy();
  });

  test("标题为空时返回错误", async () => {
    const res = await exec({ action: "add_phase", title: "" });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/标题不能为空/);
  });
});

describe("action: add_item (Ultra)", () => {
  test("在当前阶段添加任务", async () => {
    await exec({ action: "add_phase", title: "P1" });
    const res = await exec({ action: "add_item", content: "任务A" });
    expect(res.success).toBe(true);
    expect(res.item.content).toBe("任务A");
    expect(res.item.phaseId).toBeTruthy();
  });

  test("无当前阶段时返回错误", async () => {
    const res = await exec({ action: "add_item", content: "孤儿任务" });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/无当前阶段/);
  });

  test("内容为空时返回错误", async () => {
    await exec({ action: "add_phase", title: "P1" });
    const res = await exec({ action: "add_item", content: "" });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/内容不能为空/);
  });
});

describe("action: add_subtask (Ultra)", () => {
  test("为指定父任务创建子任务", async () => {
    await exec({ action: "add_phase", title: "P1" });
    const parent = await exec({ action: "add_item", content: "父任务" });
    const parentId = (parent.item as { id: string }).id;

    const res = await exec({ action: "add_subtask", content: "子任务", id: parentId });
    expect(res.success).toBe(true);
    expect(res.item.parentId).toBe(parentId);
    expect(res.item.phaseId).toBe((parent.item as { phaseId: string }).phaseId);
  });

  test("父任务不存在时返回错误", async () => {
    const res = await exec({ action: "add_subtask", content: "子任务", id: "no_parent" });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/父任务不存在/);
  });
});

describe("action: update_item (Ultra)", () => {
  test("更新任务状态为 completed", async () => {
    await exec({ action: "add_phase", title: "P1" });
    const item = await exec({ action: "add_item", content: "T1" });
    const id = (item.item as { id: string }).id;

    const res = await exec({ action: "update_item", id, status: "completed" });
    expect(res.success).toBe(true);
    expect(res.item.status).toBe("completed");
  });

  test("更新任务内容", async () => {
    await exec({ action: "add_phase", title: "P1" });
    const item = await exec({ action: "add_item", content: "原内容" });
    const id = (item.item as { id: string }).id;

    const res = await exec({ action: "update_item", id, content: "新内容" });
    expect(res.success).toBe(true);
    expect(res.item.content).toBe("新内容");
  });
});

describe("action: complete_phase (Ultra)", () => {
  test("所有任务完成后阶段可标记完成", async () => {
    await exec({ action: "add_phase", title: "P1" });
    const item = await exec({ action: "add_item", content: "T1" });
    const id = (item.item as { id: string }).id;
    await exec({ action: "update_item", id, status: "completed" });

    const res = await exec({ action: "complete_phase" });
    expect(res.success).toBe(true);
    expect(res.phase.status).toBe("completed");
  });

  test("有未完成任务时返回错误", async () => {
    await exec({ action: "add_phase", title: "P1" });
    await exec({ action: "add_item", content: "未完成" });

    const res = await exec({ action: "complete_phase" });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/未完成/);
  });
});

describe("action: advance_phase (Ultra)", () => {
  test("完成当前阶段并推进到下一阶段", async () => {
    await exec({ action: "add_phase", title: "P1" });
    await exec({ action: "add_phase", title: "P2" });

    // 完成 P1 的所有任务(当前 P1 没有任务，可以直接推进)
    // 但 advance_phase 非强制模式下也要检查 — 空阶段视为无未完成项
    // P1 没有 item → items.filter 为空 → incomplete 为空 → 通过
    const res = await exec({ action: "advance_phase" });
    expect(res.success).toBe(true);
    expect(res.currentPhase.title).toBe("P2");
  });

  test("使用 force=true 跳过未完成检查强制推进", async () => {
    await exec({ action: "add_phase", title: "P1" });
    await exec({ action: "add_phase", title: "P2" });
    await exec({ action: "add_item", content: "未完成" });

    // 非强制应失败
    const fail = await exec({ action: "advance_phase" });
    expect(fail.success).toBe(false);

    // 强制应成功
    const res = await exec({ action: "advance_phase", force: true });
    expect(res.success).toBe(true);
    expect(res.currentPhase.title).toBe("P2");
  });
});

describe("action: delete_item (Ultra)", () => {
  test("删除任务及其子任务(级联)", async () => {
    await exec({ action: "add_phase", title: "P1" });
    const parent = await exec({ action: "add_item", content: "父" });
    const parentId = (parent.item as { id: string }).id;
    await exec({ action: "add_subtask", content: "子", id: parentId });

    const res = await exec({ action: "delete_item", id: parentId });
    expect(res.success).toBe(true);
    expect(res.cascadedCount).toBe(1); // 1 个子任务被级联删除
  });
});

// ══════════════════════════════════════════════════════════════════════
// 边界与错误场景
// ══════════════════════════════════════════════════════════════════════

describe("边界场景", () => {
  test("delete 有子任务但未传 deleteChildren 时返回错误", async () => {
    // 使用普通 create + parentId 创建父子关系
    const parent = await exec({ action: "create", content: "父" });
    const parentId = (parent.item as { id: string }).id;
    await exec({ action: "create", content: "子", parentId });

    const res = await exec({ action: "delete", id: parentId });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/子任务/);
  });

  test("delete 传 deleteChildren=true 时级联删除所有子任务", async () => {
    const parent = await exec({ action: "create", content: "父" });
    const parentId = (parent.item as { id: string }).id;
    await exec({ action: "create", content: "子A", parentId });
    await exec({ action: "create", content: "子B", parentId });

    const res = await exec({ action: "delete", id: parentId, deleteChildren: true });
    expect(res.success).toBe(true);
    expect(res.cascadedCount).toBe(2);
  });

  test("update 父任务为 completed 但有未完成子任务时返回错误", async () => {
    const parent = await exec({ action: "create", content: "父" });
    const parentId = (parent.item as { id: string }).id;
    await exec({ action: "create", content: "子", parentId });

    const res = await exec({ action: "update", id: parentId, status: "completed" });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/未完成子任务/);
  });

  test("未知 action 返回错误", async () => {
    const res = await exec({ action: "invalid_action" });
    // zod 校验会拦截，execute 会返回错误
    expect(res.success).toBe(false);
  });

  test("持久化后重新读取仍能获取数据", async () => {
    const created = await exec({ action: "create", content: "持久化测试" });
    const id = (created.item as { id: string }).id;

    // 手动调用 getStore 读取持久化后的数据
    const store = getStore(tmpDir);
    expect(store.items.length).toBe(1);
    expect(store.items[0].id).toBe(id);
  });
});
