/**
 * 角色管理系统 — ROLE.md 文件管理，支持角色切换、创建、删除
 *
 * 参考 snow-cli source/utils/commands/role.ts。
 * 适配: 存储路径 ~/.crab/ + 项目根，适配 crab-cli 配置结构。
 *
 * 角色: ROLE.md (默认激活角色), ROLE-<hex>.md (备用角色)
 * 子代理角色: ROLE-<agentName>.md
 * 元数据: settings.role.activeRoleId, settings.role.overrideRoleIds
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

// ─── 类型 ──────────────────────────────────────────────────

export type RoleLocation = "global" | "project";

export interface RoleItem {
  id: string;
  name: string;
  filename: string;
  isActive: boolean;
  isOverride: boolean;
  location: RoleLocation;
  path: string;
}

export interface RoleSubagentItem {
  agentName: string;
  filename: string;
  location: RoleLocation;
  path: string;
  hasContent: boolean;
}

// ─── 内部函数 ──────────────────────────────────────────────

function getRoleDir(location: RoleLocation): string {
  return location === "global" ? join(homedir(), ".crab") : process.cwd();
}

function generateRoleHash(): string {
  return randomBytes(3).toString("hex"); // 6 hex chars
}

function parseRoleFilename(filename: string): string | null {
  const match = filename.match(/^ROLE-([a-f0-9]+)\.md$/i);
  return match?.[1] ?? null;
}

function parseRoleSubagentFilename(filename: string): string | null {
  const match = filename.match(/^ROLE-(.+)\.md$/);
  if (!match || !match[1]) return null;
  // 排除 hex hash (主角色) 和 active
  if (match[1] === "active" || /^[a-f0-9]{6}$/.test(match[1])) return null;
  return match[1];
}

function readRoleFile(path: string): string {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return "";
  }
}

// ─── 主角色 CRUD ───────────────────────────────────────────

/** 创建主角色文件 (ROLE.md) */
export function createRoleFile(location: RoleLocation): string {
  const dir = getRoleDir(location);
  const path = join(dir, "ROLE.md");

  if (existsSync(path)) throw new Error(`ROLE.md 已存在于 ${dir}`);

  writeFileSync(path, "# Custom Role\n\nDefine your AI behavior rules here.\n", "utf-8");
  return path;
}

/** 创建备用角色文件 */
export function createInactiveRole(location: RoleLocation): string {
  const dir = getRoleDir(location);
  const hash = generateRoleHash();
  const path = join(dir, `ROLE-${hash}.md`);

  writeFileSync(path, `# Role ${hash}\n\nDefine your AI behavior rules here.\n`, "utf-8");
  return path;
}

/** 列出所有角色 */
export function listRoles(location: RoleLocation): RoleItem[] {
  const dir = getRoleDir(location);
  if (!existsSync(dir)) return [];

  const items: RoleItem[] = [];

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }

  for (const entry of entries) {
    // ROLE.md
    if (entry === "ROLE.md") {
      items.push({
        id: "active",
        name: "Default Role",
        filename: "ROLE.md",
        isActive: true,
        isOverride: false,
        location,
        path: join(dir, "ROLE.md"),
      });
      continue;
    }

    // ROLE-<hex>.md (备用角色)
    const hash = parseRoleFilename(entry);
    if (hash) {
      items.push({
        id: hash,
        name: `Role ${hash}`,
        filename: entry,
        isActive: false,
        isOverride: false,
        location,
        path: join(dir, entry),
      });
    }
  }

  return items.sort((a, b) => a.filename.localeCompare(b.filename));
}

/** 读取激活角色内容 */
export function loadActiveRoleContent(projectRoot?: string): string | null {
  const root = projectRoot || process.cwd();
  // 项目优先
  const projectPath = join(root, "ROLE.md");
  if (existsSync(projectPath)) return readRoleFile(projectPath);

  const globalPath = join(homedir(), ".crab", "ROLE.md");
  if (existsSync(globalPath)) return readRoleFile(globalPath);

  return null;
}

/** 读取指定角色内容 */
export function loadRoleContent(roleId: string, location: RoleLocation): string | null {
  const dir = getRoleDir(location);
  let filename: string;

  if (roleId === "active") {
    filename = "ROLE.md";
  } else {
    filename = `ROLE-${roleId}.md`;
  }

  const path = join(dir, filename);
  return existsSync(path) ? readRoleFile(path) : null;
}

/** 删除角色 */
export function deleteRole(roleId: string, location: RoleLocation): boolean {
  if (roleId === "active") {
    // 删除默认角色
    const path = join(getRoleDir(location), "ROLE.md");
    if (!existsSync(path)) return false;
    try {
      unlinkSync(path);
      return true;
    } catch {
      return false;
    }
  }

  const path = join(getRoleDir(location), `ROLE-${roleId}.md`);
  if (!existsSync(path)) return false;
  try {
    unlinkSync(path);
    return true;
  } catch {
    return false;
  }
}

/** 检查角色是否存在 */
export function checkRoleExists(location: RoleLocation): boolean {
  const dir = getRoleDir(location);
  return existsSync(join(dir, "ROLE.md"));
}

// ─── 子代理角色 CRUD ───────────────────────────────────────

/** 创建子代理角色文件 */
export function createRoleSubagentFile(agentName: string, location: RoleLocation): string {
  const dir = getRoleDir(location);
  const filename = `ROLE-${agentName}.md`;
  const path = join(dir, filename);

  if (existsSync(path)) throw new Error(`${filename} 已存在`);

  writeFileSync(path, `# Role for ${agentName}\n\nDefine custom behavior for the ${agentName} sub-agent.\n`, "utf-8");
  return path;
}

/** 列出子代理角色 */
export function listRoleSubagents(location: RoleLocation): RoleSubagentItem[] {
  const dir = getRoleDir(location);
  if (!existsSync(dir)) return [];

  const items: RoleSubagentItem[] = [];

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }

  for (const entry of entries) {
    const agentName = parseRoleSubagentFilename(entry);
    if (agentName) {
      const path = join(dir, entry);
      const content = readRoleFile(path);
      items.push({
        agentName,
        filename: entry,
        location,
        path,
        hasContent: content.trim().length > 0,
      });
    }
  }

  return items;
}

/** 加载子代理自定义角色内容 */
export function loadSubAgentCustomRole(agentName: string, projectRoot?: string): string | null {
  // 项目优先
  const projectPath = join(projectRoot ?? process.cwd(), `ROLE-${agentName}.md`);
  if (existsSync(projectPath)) return readRoleFile(projectPath);

  const globalPath = join(homedir(), ".crab", `ROLE-${agentName}.md`);
  if (existsSync(globalPath)) return readRoleFile(globalPath);

  return null;
}

/** 删除子代理角色 */
export function deleteRoleSubagentFile(agentName: string, location: RoleLocation): boolean {
  const path = join(getRoleDir(location), `ROLE-${agentName}.md`);
  if (!existsSync(path)) return false;
  try {
    unlinkSync(path);
    return true;
  } catch {
    return false;
  }
}
