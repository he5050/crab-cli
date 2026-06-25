/**
 * RoleInjector 单元测试。
 *
 * 覆盖范围:
 *   - getActiveRoleContent 无角色 / 仅项目 / 仅全局 / 两层都有
 *   - getActiveRoleContent 项目优先于全局
 *   - getActiveRoleContent Override 模式标记
 *   - getActiveRoleContent 空内容视为 null
 *   - hasOverrideRole 判断指定位置 Override
 *   - hasActiveOverrideRole 综合判断
 */
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import path from "node:path";

const BASE_CWD = process.cwd();

// ─── Mock 数据 ────────────────────────────────────────────

let mockRolesData: Record<
  string,
  {
    id: string;
    filename: string;
    isActive: boolean;
    isOverride: boolean;
    path: string;
  }[]
> = { global: [], project: [] };

let mockRoleContents: Record<string, string | null> = {};

// ─── 顶层 Mock ────────────────────────────────────────────

const roleManagerMockFactory = () => ({
  listRoles: (location: string) => mockRolesData[location] ?? [],
  readRoleContent: (roleId: string, location: string) => mockRoleContents[`${location}:${roleId}`] ?? null,
});
mock.module("@agent/roles/roleManager", roleManagerMockFactory);
mock.module(path.resolve(BASE_CWD, "src/agent/roles/roleManager"), roleManagerMockFactory);
mock.module(path.resolve(BASE_CWD, "src/agent/roles/roleManager.ts"), roleManagerMockFactory);

// ─── 静态导入 ────────────────────────────────────────────

import { getActiveRoleContent, hasOverrideRole, hasActiveOverrideRole } from "@/agent/roles/roleInjector";

// ─── 测试 ──────────────────────────────────────────────────

describe("roleInjector", () => {
  beforeEach(() => {
    mockRolesData = { global: [], project: [] };
    mockRoleContents = {};
  });

  afterEach(() => {
    // 只恢复 spyOn
  });

  // ─── getActiveRoleContent ───────────────────────────

  describe("getActiveRoleContent", () => {
    test("无角色返回 null + isOverride false", () => {
      const result = getActiveRoleContent("/project");
      expect(result.content).toBeNull();
      expect(result.isOverride).toBe(false);
    });

    test("仅项目级活跃角色", () => {
      mockRolesData.project = [
        {
          filename: "ROLE.md",
          id: "active",
          isActive: true,
          isOverride: false,
          path: "/project/ROLE.md",
        },
      ];
      mockRoleContents["project:active"] = "# Project Role";

      const result = getActiveRoleContent("/project");
      expect(result.content).toBe("# Project Role");
      expect(result.isOverride).toBe(false);
    });

    test("仅全局活跃角色", () => {
      mockRolesData.global = [
        {
          filename: "ROLE.md",
          id: "active",
          isActive: true,
          isOverride: false,
          path: "/global/ROLE.md",
        },
      ];
      mockRoleContents["global:active"] = "# Global Role";

      const result = getActiveRoleContent("/project");
      expect(result.content).toBe("# Global Role");
      expect(result.isOverride).toBe(false);
    });

    test("项目级优先于全局级", () => {
      mockRolesData.project = [
        {
          filename: "ROLE.md",
          id: "active",
          isActive: true,
          isOverride: false,
          path: "/project/ROLE.md",
        },
      ];
      mockRolesData.global = [
        {
          filename: "ROLE.md",
          id: "active",
          isActive: true,
          isOverride: false,
          path: "/global/ROLE.md",
        },
      ];
      mockRoleContents["project:active"] = "# Project Role";
      mockRoleContents["global:active"] = "# Global Role";

      expect(getActiveRoleContent("/project").content).toBe("# Project Role");
    });

    test("项目级无内容回退到全局", () => {
      mockRolesData.project = [
        {
          filename: "ROLE.md",
          id: "active",
          isActive: true,
          isOverride: false,
          path: "/project/ROLE.md",
        },
      ];
      mockRolesData.global = [
        {
          filename: "ROLE.md",
          id: "active",
          isActive: true,
          isOverride: false,
          path: "/global/ROLE.md",
        },
      ];
      mockRoleContents["project:active"] = null;
      mockRoleContents["global:active"] = "# Global Fallback";

      expect(getActiveRoleContent("/project").content).toBe("# Global Fallback");
    });

    test("Override 模式正确标记(项目级)", () => {
      mockRolesData.project = [
        {
          filename: "ROLE.md",
          id: "active",
          isActive: true,
          isOverride: true,
          path: "/project/ROLE.md",
        },
      ];
      mockRoleContents["project:active"] = "# Override Role";

      expect(getActiveRoleContent("/project").isOverride).toBe(true);
    });

    test("Override 模式正确标记(全局级)", () => {
      mockRolesData.global = [
        {
          filename: "ROLE.md",
          id: "active",
          isActive: true,
          isOverride: true,
          path: "/global/ROLE.md",
        },
      ];
      mockRoleContents["global:active"] = "# Override Global";

      const result = getActiveRoleContent("/project");
      expect(result.isOverride).toBe(true);
      expect(result.content).toBe("# Override Global");
    });

    test("空内容视为无角色(content → null, isOverride → false)", () => {
      mockRolesData.project = [
        {
          filename: "ROLE.md",
          id: "active",
          isActive: true,
          isOverride: true,
          path: "/project/ROLE.md",
        },
      ];
      mockRoleContents["project:active"] = "   \n\t  ";

      const result = getActiveRoleContent("/project");
      expect(result.content).toBeNull();
      expect(result.isOverride).toBe(false);
    });

    test("纯空字符串视为无角色", () => {
      mockRolesData.project = [
        {
          filename: "ROLE.md",
          id: "active",
          isActive: true,
          isOverride: false,
          path: "/project/ROLE.md",
        },
      ];
      mockRoleContents["project:active"] = "";

      const result = getActiveRoleContent("/project");
      expect(result.content).toBeNull();
      expect(result.isOverride).toBe(false);
    });

    test("不传 projectRoot 不报错", () => {
      const result = getActiveRoleContent();
      expect(result.content).toBeNull();
      expect(result.isOverride).toBe(false);
    });
  });

  // ─── hasOverrideRole ──────────────────────────────────

  describe("hasOverrideRole", () => {
    test("活跃角色有 Override 标记返回 true", () => {
      mockRolesData.global = [
        {
          filename: "ROLE.md",
          id: "active",
          isActive: true,
          isOverride: true,
          path: "/global/ROLE.md",
        },
      ];

      expect(hasOverrideRole("global")).toBe(true);
    });

    test("活跃角色无 Override 标记返回 false", () => {
      mockRolesData.global = [
        {
          filename: "ROLE.md",
          id: "active",
          isActive: true,
          isOverride: false,
          path: "/global/ROLE.md",
        },
      ];

      expect(hasOverrideRole("global")).toBe(false);
    });

    test("无活跃角色返回 false", () => {
      expect(hasOverrideRole("global")).toBe(false);
    });
  });

  // ─── hasActiveOverrideRole ────────────────────────────

  describe("hasActiveOverrideRole", () => {
    test("项目级 Override 生效时返回 true", () => {
      mockRolesData.project = [
        {
          filename: "ROLE.md",
          id: "active",
          isActive: true,
          isOverride: true,
          path: "/project/ROLE.md",
        },
      ];
      mockRoleContents["project:active"] = "Override content";

      expect(hasActiveOverrideRole("/project")).toBe(true);
    });

    test("全局级 Override 生效(项目无角色时)", () => {
      mockRolesData.global = [
        {
          filename: "ROLE.md",
          id: "active",
          isActive: true,
          isOverride: true,
          path: "/global/ROLE.md",
        },
      ];
      mockRoleContents["global:active"] = "Override global";

      expect(hasActiveOverrideRole("/project")).toBe(true);
    });

    test("无 Override 角色时返回 false", () => {
      expect(hasActiveOverrideRole("/project")).toBe(false);
    });

    test("有 Override 标记但空内容返回 false", () => {
      mockRolesData.project = [
        {
          filename: "ROLE.md",
          id: "active",
          isActive: true,
          isOverride: true,
          path: "/project/ROLE.md",
        },
      ];
      mockRoleContents["project:active"] = "";

      expect(hasActiveOverrideRole("/project")).toBe(false);
    });
  });
});
