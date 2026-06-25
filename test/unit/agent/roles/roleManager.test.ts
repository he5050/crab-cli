/**
 * RoleManager 单元测试。
 *
 * 覆盖范围:
 *   - getRoleFilePath / getRoleDirectory 路径计算
 *   - checkRoleExists 文件存在性
 *   - createRoleFile 创建角色文件(跳过已存在)
 *   - createInactiveRole 创建非活跃角色
 *   - deleteRoleFile / deleteRole 删除
 *   - readRoleContent / readActiveRoleContent 读取
 *   - listRoles / listAllRoles 列表
 *   - switchActiveRole 切换活跃角色
 *   - toggleRoleOverride 切换 Override 模式
 *   - ensureDefaultRole 默认角色初始化
 *   - 边界:目录不存在、权限错误、空内容
 */

import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const MOCK_GLOBAL_DIR = "/tmp/crab-test-global";
const BASE_CWD = process.cwd();

// ─── Mock 数据 ──────────────────────────────────────────────

let mockSettings: Record<string, any> = {
  global: { role: {} },
  project: { role: {} },
};

function mockReaddir(entries: string[]) {
  return spyOn(fs, "readdirSync").mockReturnValue(entries as any);
}

// ─── 顶层 Mock(必须在 import 之前)────────────────────────

// @config/paths — 完整导出
const pathsMockFactory = () => ({
  getConfigDir: () => MOCK_GLOBAL_DIR,
  getGlobalConfigPath: () => path.join(MOCK_GLOBAL_DIR, "config.json"),
  getGlobalCrabDir: () => MOCK_GLOBAL_DIR,
});
mock.module("@config/paths", pathsMockFactory);
mock.module(path.resolve(BASE_CWD, "src/config/paths"), pathsMockFactory);
mock.module(path.resolve(BASE_CWD, "src/config/paths.ts"), pathsMockFactory);

// @config/settings/unifiedSettings — alias + resolved + barrel
const settingsMockFactory = () => ({
  getSettingsPath: () => "/tmp/fake-settings.json",
  readMergedSettings: () => ({ ...mockSettings.global, ...mockSettings.project }),
  readSettings: (scope: string) => mockSettings[scope] ?? {},
  updateSettings: (scope: string, updater: (s: any) => void) => {
    if (!mockSettings[scope]) {
      mockSettings[scope] = {};
    }
    updater(mockSettings[scope]);
  },
  writeSettings: () => {},
});
mock.module("@config/settings/unifiedSettings", settingsMockFactory);
mock.module(path.resolve(BASE_CWD, "src/config/settings/unifiedSettings"), settingsMockFactory);
mock.module(path.resolve(BASE_CWD, "src/config/settings/unifiedSettings.ts"), settingsMockFactory);
// Also mock the barrel re-export
mock.module("@config/unifiedSettings", settingsMockFactory);
mock.module(path.resolve(BASE_CWD, "src/config/unifiedSettings"), settingsMockFactory);
mock.module(path.resolve(BASE_CWD, "src/config/unifiedSettings.ts"), settingsMockFactory);

// @core/logger — 提供 noop logger 以避免 CacheManager 等模块崩溃
const noopFn = () => {};
const noopLog = {
  child: () => noopLog,
  createStream: noopFn,
  debug: noopFn,
  error: noopFn,
  extend: noopFn,
  fatal: noopFn,
  flush: noopFn,
  formatMessage: (msg: string) => msg,
  info: noopFn,
  trace: noopFn,
  warn: noopFn,
};
const loggerMockFactory = () => ({
  createLogger: () => noopLog,
});
mock.module("@core/logger", loggerMockFactory);
mock.module(path.resolve(BASE_CWD, "src/core/logger"), loggerMockFactory);
mock.module(path.resolve(BASE_CWD, "src/core/logger.ts"), loggerMockFactory);

// @agent/roles/defaultRoleContent
const defaultRoleMockFactory = () => ({
  DEFAULT_ROLE_CONTENT: "# Test Default Role\n\nYou are a test assistant.",
});
mock.module("@agent/roles/defaultRoleContent", defaultRoleMockFactory);
mock.module(path.resolve(BASE_CWD, "src/agent/roles/defaultRoleContent"), defaultRoleMockFactory);
mock.module(path.resolve(BASE_CWD, "src/agent/roles/defaultRoleContent.ts"), defaultRoleMockFactory);

// ─── 静态导入 ────────────────────────────────────────────

import {
  getRoleFilePath,
  getRoleDirectory,
  checkRoleExists,
  createRoleFile,
  createInactiveRole,
  deleteRoleFile,
  deleteRole,
  readRoleContent,
  readActiveRoleContent,
  listRoles,
  listAllRoles,
  switchActiveRole,
  toggleRoleOverride,
  ensureDefaultRole,
} from "@/agent/roles/roleManager";

// ─── 测试 ──────────────────────────────────────────────────

describe("roleManager", () => {
  beforeEach(() => {
    mockSettings = { global: { role: {} }, project: { role: {} } };
  });

  afterEach(() => {
    // 只恢复 spyOn，不恢复 module mock
  });

  // ─── 路径计算 ─────────────────────────────────────────

  describe("getRoleFilePath", () => {
    test("全局路径正确", () => {
      expect(getRoleFilePath("global")).toBe(path.join(MOCK_GLOBAL_DIR, "ROLE.md"));
    });

    test("项目路径使用 projectRoot", () => {
      expect(getRoleFilePath("project", "/my/project")).toBe("/my/project/.crab/ROLE.md");
    });
  });

  describe("getRoleDirectory", () => {
    test("全局目录正确", () => {
      expect(getRoleDirectory("global")).toBe(MOCK_GLOBAL_DIR);
    });

    test("项目目录使用 projectRoot", () => {
      expect(getRoleDirectory("project", "/my/project")).toBe("/my/project/.crab");
    });
  });

  // ─── 文件存在性 ───────────────────────────────────────

  describe("checkRoleExists", () => {
    test("文件存在返回 true", () => {
      spyOn(fs, "existsSync").mockReturnValue(true);
      expect(checkRoleExists("global")).toBe(true);
    });

    test("文件不存在返回 false", () => {
      spyOn(fs, "existsSync").mockReturnValue(false);
      expect(checkRoleExists("project", "/tmp/no-project")).toBe(false);
    });
  });

  // ─── 文件创建 ─────────────────────────────────────────

  describe("createRoleFile", () => {
    test("全局创建成功(目录不存在时自动创建)", async () => {
      spyOn(fs, "existsSync").mockReturnValue(false);
      const mkdirSpy = spyOn(fs.promises, "mkdir").mockResolvedValue(undefined as any);
      const writeSpy = spyOn(fs.promises, "writeFile").mockResolvedValue(undefined as any);

      const result = await createRoleFile("global");

      expect(result.success).toBe(true);
      expect(result.path).toBe(path.join(MOCK_GLOBAL_DIR, "ROLE.md"));
      expect(mkdirSpy).toHaveBeenCalledTimes(1);
      expect(writeSpy).toHaveBeenCalledTimes(1);
    });

    test("文件已存在跳过创建", async () => {
      spyOn(fs, "existsSync").mockReturnValue(true);

      const result = await createRoleFile("global");
      expect(result.success).toBe(true);
    });

    test("写入失败返回错误", async () => {
      spyOn(fs, "existsSync").mockReturnValue(false);
      spyOn(fs.promises, "mkdir").mockRejectedValue(new Error("Permission denied"));

      const result = await createRoleFile("global");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Permission denied");
    });
  });

  describe("createInactiveRole", () => {
    test("创建非活跃角色文件", async () => {
      spyOn(fs.promises, "mkdir").mockResolvedValue(undefined as any);
      const writeSpy = spyOn(fs.promises, "writeFile").mockResolvedValue(undefined as any);

      const result = await createInactiveRole("global");

      expect(result.success).toBe(true);
      expect(result.path).toMatch(/^\/tmp\/crab-test-global\/ROLE-[a-f0-9]+\.md$/);
      expect(writeSpy).toHaveBeenCalledTimes(1);
    });

    test("写入失败返回错误", async () => {
      spyOn(fs.promises, "mkdir").mockRejectedValue(new Error("disk full"));

      const result = await createInactiveRole("global");

      expect(result.success).toBe(false);
      expect(result.error).toContain("disk full");
    });
  });

  // ─── 文件删除 ─────────────────────────────────────────

  describe("deleteRoleFile", () => {
    test("删除存在的文件", async () => {
      spyOn(fs, "existsSync").mockReturnValue(true);
      const unlinkSpy = spyOn(fs.promises, "unlink").mockResolvedValue(undefined as any);

      const result = await deleteRoleFile("global");

      expect(result.success).toBe(true);
      expect(unlinkSpy).toHaveBeenCalledTimes(1);
    });

    test("文件不存在返回错误", async () => {
      spyOn(fs, "existsSync").mockReturnValue(false);

      const result = await deleteRoleFile("global");

      expect(result.success).toBe(false);
      expect(result.error).toContain("does not exist");
    });
  });

  describe("deleteRole", () => {
    test("删除非活跃角色成功", async () => {
      spyOn(fs, "existsSync").mockReturnValue(true);
      mockReaddir(["ROLE.md", "ROLE-abc123.md"]);
      spyOn(fs.promises, "unlink").mockResolvedValue(undefined as any);

      expect(await deleteRole("abc123", "global")).toEqual({ success: true });
    });

    test("不允许删除活跃角色", async () => {
      spyOn(fs, "existsSync").mockReturnValue(true);
      mockReaddir(["ROLE.md"]);

      const result = await deleteRole("active", "global");
      expect(result.success).toBe(false);
      expect(result.error).toContain("Cannot delete active role");
    });

    test("角色不存在返回错误", async () => {
      spyOn(fs, "existsSync").mockReturnValue(true);
      mockReaddir(["ROLE.md"]);

      const result = await deleteRole("nonexistent", "global");
      expect(result.success).toBe(false);
      expect(result.error).toContain("Role not found");
    });
  });

  // ─── 文件读取 ─────────────────────────────────────────

  describe("readRoleContent", () => {
    test("读取存在的角色内容", () => {
      spyOn(fs, "existsSync").mockReturnValue(true);
      mockReaddir(["ROLE.md"]);
      spyOn(fs, "readFileSync").mockReturnValue("# My Role\n\nHello");

      expect(readRoleContent("active", "global")).toBe("# My Role\n\nHello");
    });

    test("角色不存在返回 null", () => {
      spyOn(fs, "existsSync").mockReturnValue(true);
      mockReaddir(["ROLE.md"]);

      expect(readRoleContent("nonexistent", "global")).toBeNull();
    });

    test("文件读取异常返回 null", () => {
      spyOn(fs, "existsSync").mockReturnValue(true);
      mockReaddir(["ROLE.md"]);
      spyOn(fs, "readFileSync").mockImplementation(() => {
        throw new Error("read error");
      });

      expect(readRoleContent("active", "global")).toBeNull();
    });
  });

  describe("readActiveRoleContent", () => {
    test("读取活跃角色内容", () => {
      spyOn(fs, "existsSync").mockReturnValue(true);
      mockReaddir(["ROLE.md"]);
      spyOn(fs, "readFileSync").mockReturnValue("active content");

      expect(readActiveRoleContent("global")).toBe("active content");
    });

    test("无活跃角色返回 null", () => {
      spyOn(fs, "existsSync").mockReturnValue(true);
      mockReaddir([]);

      expect(readActiveRoleContent("global")).toBeNull();
    });
  });

  // ─── 角色列表 ─────────────────────────────────────────

  describe("listRoles", () => {
    test("目录不存在返回空列表", () => {
      spyOn(fs, "existsSync").mockReturnValue(false);

      expect(listRoles("global")).toEqual([]);
    });

    test("单个 ROLE.md 正确解析", () => {
      spyOn(fs, "existsSync").mockReturnValue(true);
      mockReaddir(["ROLE.md", "package.json"]);

      const roles = listRoles("global");

      expect(roles).toHaveLength(1);
      expect(roles[0]!.id).toBe("active");
      expect(roles[0]!.filename).toBe("ROLE.md");
      expect(roles[0]!.isActive).toBe(true);
      expect(roles[0]!.location).toBe("global");
    });

    test("多个角色文件正确解析(含非活跃)", () => {
      spyOn(fs, "existsSync").mockReturnValue(true);
      mockReaddir(["ROLE-abc123.md", "ROLE.md"]);

      const roles = listRoles("global");

      expect(roles).toHaveLength(2);
      expect(roles.find((r) => r.isActive)!.id).toBe("active");
      expect(roles.find((r) => !r.isActive)!.id).toBe("abc123");
    });

    test("使用 settings.activeRoleId 指定活跃角色", () => {
      mockSettings.global.role = { activeRoleId: "abc123" };
      spyOn(fs, "existsSync").mockReturnValue(true);
      mockReaddir(["ROLE-abc123.md", "ROLE.md"]);

      expect(listRoles("global").find((r) => r.isActive)!.id).toBe("abc123");
    });

    test("overrideRoleIds 正确标记", () => {
      mockSettings.global.role = { overrideRoleIds: ["active"] };
      spyOn(fs, "existsSync").mockReturnValue(true);
      mockReaddir(["ROLE.md"]);

      expect(listRoles("global")[0]!.isOverride).toBe(true);
    });

    test("按文件名排序保持稳定性", () => {
      spyOn(fs, "existsSync").mockReturnValue(true);
      mockReaddir(["ROLE-zzz.md", "ROLE.md", "ROLE-aaa.md"]);

      const filenames = listRoles("global").map((r) => r.filename);
      for (let i = 1; i < filenames.length; i++) {
        expect(filenames[i - 1]!.localeCompare(filenames[i]!)).toBeLessThanOrEqual(0);
      }
    });

    test("忽略不匹配的文件", () => {
      spyOn(fs, "existsSync").mockReturnValue(true);
      mockReaddir(["ROLE.md", "ROLE-X.md", "README.md", "notes.txt"]);

      const roles = listRoles("global");
      expect(roles).toHaveLength(1);
      expect(roles[0]!.filename).toBe("ROLE.md");
    });

    test("readdirSync 异常返回空列表", () => {
      spyOn(fs, "existsSync").mockReturnValue(true);
      spyOn(fs, "readdirSync").mockImplementation(() => {
        throw new Error("permission denied");
      });

      expect(listRoles("global")).toEqual([]);
    });
  });

  describe("listAllRoles", () => {
    test("合并全局和项目角色", () => {
      spyOn(fs, "existsSync").mockReturnValue(true);
      spyOn(fs, "readdirSync").mockImplementation(((dir: fs.PathLike) => {
        if (String(dir) === MOCK_GLOBAL_DIR) {
          return ["ROLE.md"];
        }
        return ["ROLE-abc123.md", "ROLE.md"];
      }) as any);
      spyOn(fs, "readFileSync").mockReturnValue("content");

      const all = listAllRoles("/project-root");
      expect(all.length).toBeGreaterThanOrEqual(3);
      expect(all.some((r) => r.name.includes("[global]"))).toBe(true);
      expect(all.some((r) => r.name.includes("[project]"))).toBe(true);
    });
  });

  // ─── 角色切换 ─────────────────────────────────────────

  describe("switchActiveRole", () => {
    test("切换到存在的角色", async () => {
      spyOn(fs, "existsSync").mockReturnValue(true);
      mockReaddir(["ROLE-abc123.md", "ROLE.md"]);

      const result = await switchActiveRole("abc123", "global");

      expect(result.success).toBe(true);
      expect(mockSettings.global.role.activeRoleId).toBe("abc123");
    });

    test("切换到不存在的角色返回错误", async () => {
      spyOn(fs, "existsSync").mockReturnValue(true);
      mockReaddir(["ROLE.md"]);

      const result = await switchActiveRole("nonexistent", "global");
      expect(result.success).toBe(false);
      expect(result.error).toContain("Role not found");
    });
  });

  // ─── Override 模式 ────────────────────────────────────

  describe("toggleRoleOverride", () => {
    test("活跃角色开启 Override", async () => {
      spyOn(fs, "existsSync").mockReturnValue(true);
      mockReaddir(["ROLE.md"]);

      const result = await toggleRoleOverride("active", "global");

      expect(result.success).toBe(true);
      expect(result.isOverride).toBe(true);
      expect(mockSettings.global.role.overrideRoleIds).toContain("active");
    });

    test("活跃角色关闭 Override", async () => {
      mockSettings.global.role = { overrideRoleIds: ["active"] };
      spyOn(fs, "existsSync").mockReturnValue(true);
      mockReaddir(["ROLE.md"]);

      const result = await toggleRoleOverride("active", "global");

      expect(result.success).toBe(true);
      expect(result.isOverride).toBe(false);
      expect(mockSettings.global.role.overrideRoleIds).not.toContain("active");
    });

    test("非活跃角色不允许切换 Override", async () => {
      spyOn(fs, "existsSync").mockReturnValue(true);
      mockReaddir(["ROLE-abc123.md", "ROLE.md"]);

      const result = await toggleRoleOverride("abc123", "global");
      expect(result.success).toBe(false);
      expect(result.error).toContain("Only the active role");
    });

    test("角色不存在返回错误", async () => {
      spyOn(fs, "existsSync").mockReturnValue(true);
      mockReaddir(["ROLE.md"]);

      const result = await toggleRoleOverride("nonexistent", "global");
      expect(result.success).toBe(false);
      expect(result.error).toContain("Role not found");
    });
  });

  // ─── 默认角色初始化 ──────────────────────────────────

  describe("ensureDefaultRole", () => {
    test("文件不存在时创建默认角色", async () => {
      spyOn(fs, "existsSync").mockReturnValue(false);
      const mkdirSpy = spyOn(fs.promises, "mkdir").mockResolvedValue(undefined as any);
      const writeSpy = spyOn(fs.promises, "writeFile").mockResolvedValue(undefined as any);

      await ensureDefaultRole();

      expect(mkdirSpy).toHaveBeenCalledTimes(1);
      expect(writeSpy).toHaveBeenCalledTimes(1);
    });

    test("文件已存在时跳过创建", async () => {
      spyOn(fs, "existsSync").mockReturnValue(true);

      await ensureDefaultRole();
    });

    test("创建失败静默处理(不影响启动)", async () => {
      spyOn(fs, "existsSync").mockReturnValue(false);
      spyOn(fs.promises, "mkdir").mockRejectedValue(new Error("IO error"));

      await ensureDefaultRole();
    });
  });
});
