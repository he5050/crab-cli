/**
 * 自定义命令核心 — 用户自定义 slash 命令的 CRUD 与持久化
 *
 * 参考 snow-cli source/utils/commands/custom.ts。
 * 适配: 存储路径 ~/.crab/commands/，适配 Bun 运行时，简化注册逻辑。
 *
 * 存储: ~/.crab/commands/<commandName>.json (全局) 或 .crab/commands/<commandName>.json (项目)
 * 命名空间: deploy:staging -> commands/deploy/staging.json
 * 类型: execute (shell执行) / prompt (发送给AI)
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

// ─── 类型 ──────────────────────────────────────────────────

export type CommandLocation = "global" | "project";

export interface CustomCommand {
  name: string;
  command: string;
  type: "execute" | "prompt";
  description?: string;
  location?: CommandLocation;
}

// ─── 常量 ──────────────────────────────────────────────────

const GLOBAL_COMMANDS_DIR = () => join(homedir(), ".crab", "commands");
const PROJECT_COMMANDS_DIR = () => join(process.cwd(), ".crab", "commands");

// ─── 内部函数 ──────────────────────────────────────────────

function getCommandDir(location: CommandLocation): string {
  const dir = location === "global" ? GLOBAL_COMMANDS_DIR() : PROJECT_COMMANDS_DIR();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function getCommandJsonFilePath(name: string, location: CommandLocation): string {
  return `${join(getCommandDir(location), ...name.split(":"))}.json`;
}

function parseNamespacedName(name: string): { namespacePath: string | null; commandName: string } {
  const firstColon = name.indexOf(":");
  if (firstColon === -1) return { namespacePath: null, commandName: name };
  return { namespacePath: name.slice(0, firstColon), commandName: name.slice(firstColon + 1) };
}

function listJsonCommandsRecursively(dir: string, prefix = ""): CustomCommand[] {
  if (!existsSync(dir)) return [];
  const results: CustomCommand[] = [];

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }

  // 目录优先排序
  const sorted = entries.sort((a, b) => {
    const aIsDir = statSync(join(dir, a)).isDirectory() ? 0 : 1;
    const bIsDir = statSync(join(dir, b)).isDirectory() ? 0 : 1;
    return aIsDir - bIsDir || a.localeCompare(b);
  });

  for (const entry of sorted) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      const ns = prefix ? `${prefix}:${entry}` : entry;
      results.push(...listJsonCommandsRecursively(fullPath, ns));
    } else if (entry.endsWith(".json")) {
      const cmdName = prefix ? `${prefix}:${entry.slice(0, -5)}` : entry.slice(0, -5);
      try {
        const raw = readFileSync(fullPath, "utf-8");
        const parsed = JSON.parse(raw);
        results.push({ ...parsed, name: cmdName });
      } catch {
        // 跳过解析失败的文件
      }
    }
  }

  return results;
}

// ─── 公开 API ──────────────────────────────────────────────

/** 加载所有自定义命令（项目优先于全局同名命令） */
export function loadCustomCommands(projectRoot?: string): CustomCommand[] {
  const projectDir = projectRoot ? join(projectRoot, ".crab", "commands") : PROJECT_COMMANDS_DIR();
  const globalDir = GLOBAL_COMMANDS_DIR();

  const projectCommands = listJsonCommandsRecursively(projectDir);
  const globalCommands = listJsonCommandsRecursively(globalDir);

  // 项目命令优先
  const nameSet = new Set(projectCommands.map((c) => c.name));
  return [...projectCommands, ...globalCommands.filter((c) => !nameSet.has(c.name))];
}

/** 按作用域加载自定义命令 */
export function loadCustomCommandsForLocation(location: CommandLocation, projectRoot?: string): CustomCommand[] {
  if (location === "global") {
    return listJsonCommandsRecursively(GLOBAL_COMMANDS_DIR());
  }
  const projectDir = projectRoot ? join(projectRoot, ".crab", "commands") : PROJECT_COMMANDS_DIR();
  return listJsonCommandsRecursively(projectDir);
}

/** 检查命令文件是否存在 */
export function checkCommandExists(name: string, location: CommandLocation): boolean {
  return existsSync(getCommandJsonFilePath(name, location));
}

/** 保存自定义命令 */
export function saveCustomCommand(
  name: string,
  command: string,
  type: "execute" | "prompt",
  description?: string,
  location: CommandLocation = "global",
): void {
  const filePath = getCommandJsonFilePath(name, location);
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const data: CustomCommand = { name, command, type, description, location };
  writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

/** 删除自定义命令 */
export function deleteCustomCommand(name: string, location: CommandLocation): boolean {
  const filePath = getCommandJsonFilePath(name, location);
  if (!existsSync(filePath)) return false;
  try {
    unlinkSync(filePath);
    return true;
  } catch {
    return false;
  }
}

/** 列出所有自定义命令（带前缀信息） */
export function listCustomCommands(projectRoot?: string): {
  global: CustomCommand[];
  project: CustomCommand[];
} {
  const projectDir = projectRoot ? join(projectRoot, ".crab", "commands") : PROJECT_COMMANDS_DIR();
  return {
    global: listJsonCommandsRecursively(GLOBAL_COMMANDS_DIR()),
    project: listJsonCommandsRecursively(projectDir),
  };
}

/** 解析命名空间命令名 */
export function parseCustomCommandName(name: string): { namespacePath: string | null; commandName: string } {
  return parseNamespacedName(name);
}
