/**
 * 持久化权限管理测试。
 *
 * 测试用例:
 *   - addPersistentPermission: 新建规则
 *   - addPersistentPermission: 幂等更新(相同 permission+pattern 更新而非重复插入)
 *   - loadPersistentPermissions: 返回全部规则
 *   - loadPersistentPermissions: 无规则时返回空数组
 *   - findPersistentPermission: 找到匹配规则
 *   - findPersistentPermission: 无匹配时返回 null
 *   - removePersistentPermission: 删除已有规则
 *   - removePersistentPermission: 不存在的 id 返回 false
 *   - clearPersistentPermissions: 清除全部并返回数量
 *   - clearPersistentPermissions: 空表返回 0
 */
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { cleanupTestDir, createGlobalTmpTestDir } from "../../helpers/testPaths";

// 测试用独立数据库路径
let testDir: string;
let testDbPath: string;

// 模块导入(延迟，确保每个 test 文件独立)
let initDb: typeof import("@/db").initDb;
let getDb: typeof import("@/db").getDb;
let closeDb: typeof import("@/db").closeDb;
let resetDb: typeof import("@/db").resetDb;

let addPersistentPermission: typeof import("@/session/permissions").addPersistentPermission;
let loadPersistentPermissions: typeof import("@/session/permissions").loadPersistentPermissions;
let findPersistentPermission: typeof import("@/session/permissions").findPersistentPermission;
let removePersistentPermission: typeof import("@/session/permissions").removePersistentPermission;
let clearPersistentPermissions: typeof import("@/session/permissions").clearPersistentPermissions;

beforeEach(() => {
  // 每个测试前创建新的临时目录和数据库
  testDir = createGlobalTmpTestDir("crab-test-perm-");
  testDbPath = join(testDir, "test.db");

  // 动态导入以确保模块状态干净
  const db = require("@/db") as typeof import("@/db");
  ({ initDb } = db);
  ({ getDb } = db);
  ({ closeDb } = db);
  ({ resetDb } = db);

  const perm = require("@/session/permissions") as typeof import("@/session/permissions");
  ({ addPersistentPermission } = perm);
  ({ loadPersistentPermissions } = perm);
  ({ findPersistentPermission } = perm);
  ({ removePersistentPermission } = perm);
  ({ clearPersistentPermissions } = perm);

  // 初始化测试数据库
  resetDb();
  initDb(testDbPath);
});

afterAll(() => {
  closeDb();
  if (testDir && existsSync(testDir)) {
    cleanupTestDir(testDir);
  }
});

// ─── addPersistentPermission ──────────────────────────────────────

describe("addPersistentPermission", () => {
  test("新建规则写入数据库", () => {
    addPersistentPermission("bash", "git *", "allow", "user");

    const rules = loadPersistentPermissions();
    expect(rules).toHaveLength(1);
    expect(rules[0]!.permission).toBe("bash");
    expect(rules[0]!.pattern).toBe("git *");
    expect(rules[0]!.action).toBe("allow");
    expect(rules[0]!.source).toBe("user");
    expect(rules[0]!.id).toBeGreaterThan(0);
    expect(typeof rules[0]!.createdAt).toBe("number");
  });

  test("幂等 — 同一 permission+pattern 更新已有记录而非重复插入", () => {
    addPersistentPermission("bash", "git *", "allow", "user");
    const first = loadPersistentPermissions();
    const originalId = first[0]!.id;

    // 相同 permission+pattern，不同 action/source → 应更新而非新增
    addPersistentPermission("bash", "git *", "deny", "project");
    const rules = loadPersistentPermissions();

    expect(rules).toHaveLength(1); // 仍然只有一条
    expect(rules[0]!.id).toBe(originalId); // ID 不变
    expect(rules[0]!.action).toBe("deny"); // action 已更新
    expect(rules[0]!.source).toBe("project"); // source 已更新
    // createdAt 应被刷新
    expect(rules[0]!.createdAt).toBeGreaterThanOrEqual(first[0]!.createdAt);
  });

  test("不同 permission 或 pattern 可以并存", () => {
    addPersistentPermission("bash", "git *", "allow");
    addPersistentPermission("bash", "npm *", "deny");
    addPersistentPermission("fs.write", "*.ts", "allow");

    const rules = loadPersistentPermissions();
    expect(rules).toHaveLength(3);
    expect(rules.map((r) => r.pattern)).toEqual(["git *", "npm *", "*.ts"]);
  });
});

// ─── loadPersistentPermissions ────────────────────────────────────

describe("loadPersistentPermissions", () => {
  test("返回全部已存规则", () => {
    addPersistentPermission("bash", "git *", "allow", "user");
    addPersistentPermission("fs.write", "*.ts", "deny", "project");

    const rules = loadPersistentPermissions();
    expect(rules).toHaveLength(2);
    expect(rules[0]!.permission).toBe("bash");
    expect(rules[1]!.permission).toBe("fs.write");
  });

  test("无规则时返回空数组", () => {
    const rules = loadPersistentPermissions();
    expect(rules).toEqual([]);
  });
});

// ─── findPersistentPermission ────────────────────────────────────

describe("findPersistentPermission", () => {
  test("精确匹配返回对应规则", () => {
    addPersistentPermission("bash", "git *", "allow", "user");

    const found = findPersistentPermission("bash", "git *");
    expect(found).not.toBeNull();
    expect(found!.permission).toBe("bash");
    expect(found!.pattern).toBe("git *");
    expect(found!.action).toBe("allow");
    expect(found!.source).toBe("user");
    expect(typeof found!.id).toBe("number");
  });

  test("permission 匹配但 pattern 不匹配时返回 null", () => {
    addPersistentPermission("bash", "git *", "allow");

    const found = findPersistentPermission("bash", "npm *");
    expect(found).toBeNull();
  });

  test("无任何规则时返回 null", () => {
    const found = findPersistentPermission("bash", "git *");
    expect(found).toBeNull();
  });
});

// ─── removePersistentPermission ───────────────────────────────────

describe("removePersistentPermission", () => {
  test("删除已存在的规则并返回 true", () => {
    addPersistentPermission("bash", "git *", "allow");
    const rules = loadPersistentPermissions();
    expect(rules).toHaveLength(1);
    const id = rules[0]!.id;

    const result = removePersistentPermission(id);
    expect(result).toBe(true);
    expect(loadPersistentPermissions()).toHaveLength(0);
  });

  test("不存在的 id 返回 false", () => {
    const result = removePersistentPermission(99999);
    expect(result).toBe(false);
  });

  test("删除后再删除同 id 返回 false", () => {
    addPersistentPermission("bash", "git *", "allow");
    const id = loadPersistentPermissions()[0]!.id;

    expect(removePersistentPermission(id)).toBe(true);
    expect(removePersistentPermission(id)).toBe(false);
  });
});

// ─── clearPersistentPermissions ───────────────────────────────────

describe("clearPersistentPermissions", () => {
  test("清除全部规则并返回删除数量", () => {
    addPersistentPermission("bash", "git *", "allow");
    addPersistentPermission("fs.write", "*.ts", "deny");
    addPersistentPermission("fs.read", "*.json", "allow");

    const count = clearPersistentPermissions();
    expect(count).toBe(3);
    expect(loadPersistentPermissions()).toEqual([]);
  });

  test("空表时返回 0", () => {
    const count = clearPersistentPermissions();
    expect(count).toBe(0);
  });
});
