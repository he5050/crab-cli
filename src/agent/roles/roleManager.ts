/**
 * 角色文件管理 — Markdown 角色的 CRUD、切换、Override 模式。
 *
 * 职责:
 *   - 管理 ROLE.md / ROLE-<hash>.md 文件的创建、读取、删除
 *   - 支持全局(~/.crab/)和项目级(./.crab/)两种作用域
 *   - 持久化活跃角色 ID 和 Override 标记到 settings.json
 *
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  getGlobalCrabDir,
  type PersistentSettingsScope,
  type UnifiedSettings,
  readSettings,
  updateSettings,
} from "@/config";
import { DEFAULT_ROLE_CONTENT } from "./defaultRoleContent";

// ─── 类型 ──────────────────────────────────────────────────

/** 角色作用域 */
export type RoleLocation = "global" | "project";

/** 角色配置(存储在 settings.json 的 role 字段) */
type RoleConfig = NonNullable<UnifiedSettings["role"]>;

/** 角色列表项 */
export interface RoleItem {
  /** 唯一标识('active' 或随机 hash) */
  id: string;
  /** 显示名称 */
  name: string;
  /** 文件名(ROLE.md / ROLE-<hash>.md) */
  filename: string;
  /** 是否为当前活跃角色 */
  isActive: boolean;
  /** 是否标记为 Override 模式 */
  isOverride: boolean;
  /** 作用域 */
  location: RoleLocation;
  /** 完整文件路径 */
  path: string;
}

const DEFAULT_ACTIVE_ROLE_ID = "active";

// ─── 内部工具 ──────────────────────────────────────────────

/** 将 RoleLocation 映射到 PersistentSettingsScope */
function toSettingsScope(location: RoleLocation): PersistentSettingsScope {
  return location === "global" ? "global" : "project";
}

/** 读取角色配置 */
function readRoleConfig(location: RoleLocation, projectRoot?: string): RoleConfig {
  const settings = readSettings(toSettingsScope(location), projectRoot);
  return settings.role ?? {};
}

/** 写入角色配置 */
async function writeRoleConfig(location: RoleLocation, config: RoleConfig, projectRoot?: string): Promise<void> {
  updateSettings(
    toSettingsScope(location),
    (settings) => {
      settings.role = config;
    },
    projectRoot,
  );
}

/** 生成 6 位随机 hex hash */
function generateRoleHash(): string {
  return crypto.randomBytes(3).toString("hex");
}

/**
 * 解析角色文件名，提取 hash 后缀。
 * ROLE.md → null(活跃角色)
 * ROLE-abc123.md → 'abc123'
 */
function parseRoleFilename(filename: string): string | null {
  const match = filename.match(/^ROLE-([a-f0-9]+)\.md$/i);
  return match && match[1] ? match[1] : null;
}

/**
 * 解析当前活跃角色 ID。
 * 优先使用 settings.json 中配置的值，否则默认 ROLE.md。
 */
function resolveActiveRoleId(
  location: RoleLocation,
  projectRoot: string | undefined,
  scanned: { id: string; filename: string }[],
): string {
  const config = readRoleConfig(location, projectRoot);
  const configured = config.activeRoleId;
  if (configured && scanned.some((r) => r.id === configured)) {
    return configured;
  }
  // 默认使用 ROLE.md(id='active')
  if (scanned.some((r) => r.id === DEFAULT_ACTIVE_ROLE_ID || r.filename === "ROLE.md")) {
    return DEFAULT_ACTIVE_ROLE_ID;
  }
  return scanned[0]?.id ?? DEFAULT_ACTIVE_ROLE_ID;
}

// ─── 路径 ──────────────────────────────────────────────────

/**
 * 获取角色文件路径。
 * - global: ~/.crab/ROLE.md
 * - project: <projectRoot>/.crab/ROLE.md
 */
export function getRoleFilePath(location: RoleLocation, projectRoot?: string): string {
  if (location === "global") {
    return path.join(getGlobalCrabDir(), "ROLE.md");
  }
  return path.join(getRoleDirectory(location, projectRoot), "ROLE.md");
}

/**
 * 获取角色文件所在目录。
 */
export function getRoleDirectory(location: RoleLocation, projectRoot?: string): string {
  if (location === "global") {
    return getGlobalCrabDir();
  }
  return path.join(projectRoot ?? process.cwd(), ".crab");
}

// ─── 文件存在性 ────────────────────────────────────────────

/**
 * 检查指定位置的角色文件是否存在。
 */
export function checkRoleExists(location: RoleLocation, projectRoot?: string): boolean {
  return fs.existsSync(getRoleFilePath(location, projectRoot));
}

// ─── 文件创建 ──────────────────────────────────────────────

/**
 * 创建角色文件(ROLE.md)。
 * 如果是全局作用域，会自动创建父目录。
 */
export async function createRoleFile(
  location: RoleLocation,
  projectRoot?: string,
): Promise<{ success: boolean; path: string; error?: string }> {
  try {
    const roleFilePath = getRoleFilePath(location, projectRoot);

    if (location === "global" || location === "project") {
      const dir = path.dirname(roleFilePath);
      await fs.promises.mkdir(dir, { recursive: true });
    }

    // 如果已存在则跳过
    if (fs.existsSync(roleFilePath)) {
      return { path: roleFilePath, success: true };
    }

    await fs.promises.writeFile(roleFilePath, "", "utf8");
    return { path: roleFilePath, success: true };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Unknown error",
      path: "",
      success: false,
    };
  }
}

/**
 * 创建一个非活跃角色文件(ROLE-<hash>.md)。
 */
export async function createInactiveRole(
  location: RoleLocation,
  projectRoot?: string,
): Promise<{ success: boolean; path: string; error?: string }> {
  try {
    const dir = getRoleDirectory(location, projectRoot);

    if (location === "global" || location === "project") {
      await fs.promises.mkdir(dir, { recursive: true });
    }

    const hash = generateRoleHash();
    const filename = `ROLE-${hash}.md`;
    const filePath = path.join(dir, filename);

    await fs.promises.writeFile(filePath, "", "utf8");
    return { path: filePath, success: true };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Unknown error",
      path: "",
      success: false,
    };
  }
}

// ─── 文件删除 ──────────────────────────────────────────────

/**
 * 删除指定位置的角色文件(ROLE.md)。
 */
export async function deleteRoleFile(
  location: RoleLocation,
  projectRoot?: string,
): Promise<{ success: boolean; path: string; error?: string }> {
  try {
    const roleFilePath = getRoleFilePath(location, projectRoot);

    if (!fs.existsSync(roleFilePath)) {
      return {
        error: "ROLE.md does not exist at this location",
        path: roleFilePath,
        success: false,
      };
    }

    await fs.promises.unlink(roleFilePath);
    return { path: roleFilePath, success: true };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Unknown error",
      path: "",
      success: false,
    };
  }
}

/**
 * 删除指定角色(仅允许删除非活跃角色)。
 */
export async function deleteRole(
  roleId: string,
  location: RoleLocation,
  projectRoot?: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const roles = listRoles(location, projectRoot);
    const target = roles.find((r) => r.id === roleId);

    if (!target) {
      return { error: "Role not found", success: false };
    }

    if (target.isActive) {
      return { error: "Cannot delete active role", success: false };
    }

    await fs.promises.unlink(target.path);

    // 如果 config 中指向此角色，回退到 ROLE.md
    const config = readRoleConfig(location, projectRoot);
    if (config.activeRoleId === roleId) {
      await writeRoleConfig(location, { ...config, activeRoleId: DEFAULT_ACTIVE_ROLE_ID }, projectRoot);
    }

    return { success: true };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Unknown error",
      success: false,
    };
  }
}

// ─── 文件读取 ──────────────────────────────────────────────

/**
 * 读取角色文件内容。
 */
export function readRoleContent(roleId: string, location: RoleLocation, projectRoot?: string): string | null {
  const roles = listRoles(location, projectRoot);
  const target = roles.find((r) => r.id === roleId);

  if (!target) {
    return null;
  }
  if (!fs.existsSync(target.path)) {
    return null;
  }

  try {
    return fs.readFileSync(target.path, "utf8");
  } catch {
    return null;
  }
}

/**
 * 读取指定位置活跃角色的内容。
 * 如果活跃角色不存在或内容为空，返回 null。
 */
export function readActiveRoleContent(location: RoleLocation, projectRoot?: string): string | null {
  const roles = listRoles(location, projectRoot);
  const active = roles.find((r) => r.isActive);
  if (!active) {
    return null;
  }

  return readRoleContent(active.id, location, projectRoot);
}

// ─── 角色列表 ──────────────────────────────────────────────

/**
 * 列出指定位置的所有角色文件。
 */
export function listRoles(location: RoleLocation, projectRoot?: string): RoleItem[] {
  const dir = getRoleDirectory(location, projectRoot);
  const roles: RoleItem[] = [];

  if (!fs.existsSync(dir)) {
    return roles;
  }

  try {
    const files = fs.readdirSync(dir);
    const scanned: { id: string; filename: string }[] = [];

    for (const file of files) {
      if (file === "ROLE.md" || /^ROLE-[a-f0-9]+\.md$/i.test(file)) {
        const isRoleMd = file === "ROLE.md";
        const hash = parseRoleFilename(file);
        const id = isRoleMd ? DEFAULT_ACTIVE_ROLE_ID : (hash ?? file);
        scanned.push({ filename: file, id });
      }
    }

    if (scanned.length === 0) {
      return roles;
    }

    const activeRoleId = resolveActiveRoleId(location, projectRoot, scanned);
    const config = readRoleConfig(location, projectRoot);
    const overrideSet = new Set(config.overrideRoleIds ?? []);

    for (const item of scanned) {
      const isActive = item.id === activeRoleId;
      roles.push({
        filename: item.filename,
        id: item.id,
        isActive,
        isOverride: overrideSet.has(item.id),
        location,
        name: isActive ? "Active Role" : `Role (${item.id})`,
        path: path.join(dir, item.filename),
      });
    }
  } catch {
    // 目录读取失败，返回空列表
  }

  // 按文件名排序保持稳定性
  return roles.toSorted((a, b) => a.filename.localeCompare(b.filename));
}

/**
 * 列出所有位置的角色(合并全局和项目)。
 */
export function listAllRoles(projectRoot?: string): RoleItem[] {
  const global = listRoles("global", projectRoot).map((r) => ({
    ...r,
    name: `${r.name} [global]`,
  }));
  const project = listRoles("project", projectRoot).map((r) => ({
    ...r,
    name: `${r.name} [project]`,
  }));
  return [...project, ...global];
}

// ─── 角色切换 ──────────────────────────────────────────────

/**
 * 切换活跃角色。将选中的角色 ID 持久化到 settings.json。
 */
export async function switchActiveRole(
  roleId: string,
  location: RoleLocation,
  projectRoot?: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const roles = listRoles(location, projectRoot);
    const target = roles.find((r) => r.id === roleId);

    if (!target) {
      return { error: "Role not found", success: false };
    }

    const previous = readRoleConfig(location, projectRoot);
    await writeRoleConfig(location, { ...previous, activeRoleId: roleId }, projectRoot);
    return { success: true };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Unknown error",
      success: false,
    };
  }
}

// ─── Override 模式 ─────────────────────────────────────────

/**
 * 切换角色的 Override 标记。
 * 仅允许标记活跃角色为 Override。
 * Override 模式下，角色内容替换基础身份提示，仍保留模式、工具、环境等运行时提示段。
 */
export async function toggleRoleOverride(
  roleId: string,
  location: RoleLocation,
  projectRoot?: string,
): Promise<{ success: boolean; isOverride?: boolean; error?: string }> {
  try {
    const roles = listRoles(location, projectRoot);
    const target = roles.find((r) => r.id === roleId);

    if (!target) {
      return { error: "Role not found", success: false };
    }

    if (!target.isActive) {
      return {
        error: "Only the active role can be marked as override",
        success: false,
      };
    }

    const config = readRoleConfig(location, projectRoot);
    const current = new Set(config.overrideRoleIds ?? []);
    let nextIsOverride: boolean;

    if (current.has(roleId)) {
      current.delete(roleId);
      nextIsOverride = false;
    } else {
      current.add(roleId);
      nextIsOverride = true;
    }

    await writeRoleConfig(location, { ...config, overrideRoleIds: [...current] }, projectRoot);
    return { isOverride: nextIsOverride, success: true };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Unknown error",
      success: false,
    };
  }
}

// ─── 默认角色初始化 ────────────────────────────────────

/**
 * 确保全局默认角色文件存在。
 * 如果 ~/.crab/ROLE.md 不存在，则使用预设内容创建。
 */
export async function ensureDefaultRole(): Promise<void> {
  const rolePath = getRoleFilePath("global");
  if (!fs.existsSync(rolePath)) {
    try {
      const dir = path.dirname(rolePath);
      await fs.promises.mkdir(dir, { recursive: true });
      await fs.promises.writeFile(rolePath, DEFAULT_ROLE_CONTENT, "utf8");
    } catch {
      // 静默失败，不影响启动
    }
  }
}
