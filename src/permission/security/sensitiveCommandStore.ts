/**
 * 敏感命令配置存储模块 — CRUD + 持久化
 *
 * 职责:
 *   - 预设敏感命令列表（40+ 规则）
 *   - 配置文件读写（global + project 双作用域）
 *   - 敏感命令的增删改查（add / remove / toggle / reset）
 *   - 合并 global + project 返回全量命令列表
 *
 * 边界:
 *   - 不涉及命令匹配逻辑（由 sensitiveCommandMatcher 负责）
 *   - 不涉及危险/自毁命令检测（由 dangerDetector 负责）
 */

import fs from "node:fs";
import path from "node:path";
import { createLogger } from "@/core/logging/logger";
import { getGlobalCrabDir } from "@/config";
import { createInternalError } from "@/core/errors/appError";
import { prefixedId } from "@/core/id";
import { invalidateSensitiveCommandCache } from "./sensitiveCommandMatcher";

const log = createLogger("permission:sensitive-command");

// ─── 类型定义 ────────────────────────────────────────────

export type SensitiveCommandScope = "global" | "project";

export interface SensitiveCommand {
  id: string;
  pattern: string;
  description: string;
  enabled: boolean;
  isPreset: boolean;
  scope: SensitiveCommandScope;
}

export interface StoredSensitiveCommand {
  id: string;
  pattern: string;
  description: string;
  enabled: boolean;
  isPreset: boolean;
}

export interface SensitiveCommandsConfig {
  commands: StoredSensitiveCommand[];
}

// ─── 预设命令列表 ────────────────────────────────────────

/** 预设的常见敏感指令 */
export const PRESET_SENSITIVE_COMMANDS: StoredSensitiveCommand[] = [
  // 文件删除
  { description: "删除文件或目录", enabled: true, id: "rm", isPreset: true, pattern: "rm " },
  { description: "删除空目录", enabled: true, id: "rmdir", isPreset: true, pattern: "rmdir " },
  { description: "删除文件 (unlink)", enabled: true, id: "unlink", isPreset: true, pattern: "unlink " },
  {
    description: "移动文件到临时目录(可能数据丢失)",
    enabled: false,
    id: "mv-to-trash",
    isPreset: true,
    pattern: "mv * /tmp",
  },
  // 权限
  { description: "修改文件权限", enabled: false, id: "chmod", isPreset: true, pattern: "chmod " },
  { description: "修改文件所有者", enabled: false, id: "chown", isPreset: true, pattern: "chown " },
  // 磁盘/格式化
  { description: "底层磁盘拷贝", enabled: true, id: "dd", isPreset: true, pattern: "dd " },
  { description: "格式化文件系统", enabled: true, id: "mkfs", isPreset: true, pattern: "mkfs" },
  { description: "磁盘分区操作", enabled: true, id: "fdisk", isPreset: true, pattern: "fdisk " },
  // 进程管理
  { description: "按名称终止所有进程", enabled: false, id: "killall", isPreset: true, pattern: "killall " },
  { description: "按模式终止进程", enabled: false, id: "pkill", isPreset: true, pattern: "pkill " },
  // 系统操作
  { description: "重启系统", enabled: true, id: "reboot", isPreset: true, pattern: "reboot" },
  { description: "关机", enabled: true, id: "shutdown", isPreset: true, pattern: "shutdown " },
  // 提权
  { description: "以超级用户权限执行", enabled: false, id: "sudo", isPreset: true, pattern: "sudo " },
  { description: "切换用户", enabled: false, id: "su", isPreset: true, pattern: "su " },
  // 网络请求
  {
    description: "HTTP POST 请求(可能传输数据)",
    enabled: false,
    id: "curl-post",
    isPreset: true,
    pattern: "curl*-X POST",
  },
  { description: "从网络下载文件", enabled: false, id: "wget", isPreset: true, pattern: "wget " },
  // Git 危险操作
  { description: "推送到远程仓库", enabled: false, id: "git-push", isPreset: true, pattern: "git push" },
  {
    description: "强制推送(破坏性)",
    enabled: true,
    id: "git-force-push",
    isPreset: true,
    pattern: "git push*--force",
  },
  {
    description: "强制推送 -f(破坏性)",
    enabled: true,
    id: "git-force-push-short",
    isPreset: true,
    pattern: "git push*-f ",
  },
  {
    description: "硬重置 Git 仓库(破坏性)",
    enabled: true,
    id: "git-reset-hard",
    isPreset: true,
    pattern: "git reset*--hard",
  },
  { description: "删除 Git 未跟踪文件", enabled: true, id: "git-clean", isPreset: true, pattern: "git clean*-f" },
  { description: "撤销 Git 提交", enabled: false, id: "git-revert", isPreset: true, pattern: "git revert" },
  { description: "重置 Git 仓库状态", enabled: false, id: "git-reset", isPreset: true, pattern: "git reset " },
  // 包管理
  { description: "发布 npm 包", enabled: true, id: "npm-publish", isPreset: true, pattern: "npm publish" },
  // Docker
  { description: "删除 Docker 容器", enabled: false, id: "docker-rm", isPreset: true, pattern: "docker rm" },
  { description: "删除 Docker 镜像", enabled: false, id: "docker-rmi", isPreset: true, pattern: "docker rmi" },
  // PowerShell
  { description: "PowerShell 删除文件", enabled: true, id: "ps-remove-item", isPreset: true, pattern: "Remove-Item " },
  {
    description: "PowerShell 递归删除(破坏性)",
    enabled: true,
    id: "ps-remove-recurse",
    isPreset: true,
    pattern: "Remove-Item*-Recurse",
  },
  {
    description: "格式化磁盘卷(破坏性)",
    enabled: true,
    id: "format-volume",
    isPreset: true,
    pattern: "Format-Volume",
  },
  // 数据库
  { description: "MySQL 客户端(直接数据库访问)", enabled: false, id: "mysql", isPreset: true, pattern: "mysql " },
  { description: "PostgreSQL 客户端(直接数据库访问)", enabled: false, id: "psql", isPreset: true, pattern: "psql " },
  {
    description: "SQLite3 客户端(直接数据库访问)",
    enabled: false,
    id: "sqlite3",
    isPreset: true,
    pattern: "sqlite3 ",
  },
  {
    description: "MongoDB Shell(直接数据库访问)",
    enabled: false,
    id: "mongosh",
    isPreset: true,
    pattern: "mongosh ",
  },
  {
    description: "Redis 客户端(直接缓存/数据库访问)",
    enabled: false,
    id: "redis-cli",
    isPreset: true,
    pattern: "redis-cli ",
  },
  {
    description: "SQL Server 客户端(直接数据库访问)",
    enabled: false,
    id: "sqlcmd",
    isPreset: true,
    pattern: "sqlcmd ",
  },
  // SQL 危险语句
  { description: "删除数据库表(破坏性)", enabled: true, id: "sql-drop-table", isPreset: true, pattern: "DROP TABLE" },
  {
    description: "删除整个数据库(破坏性)",
    enabled: true,
    id: "sql-drop-database",
    isPreset: true,
    pattern: "DROP DATABASE",
  },
  {
    description: "清空数据表所有行(破坏性)",
    enabled: true,
    id: "sql-truncate",
    isPreset: true,
    pattern: "TRUNCATE ",
  },
  { description: "删除数据表行", enabled: false, id: "sql-delete", isPreset: true, pattern: "DELETE FROM" },
];

// ─── 配置存储接口 ────────────────────────────────────────

/** 敏感命令配置存储接口 */
export interface ISensitiveCommandConfigStore {
  loadScopedConfig(scope: SensitiveCommandScope): SensitiveCommandsConfig;
  saveScopedConfig(scope: SensitiveCommandScope, config: SensitiveCommandsConfig): void;
}

// ─── 配置读写辅助 ────────────────────────────────────────

/** 全局配置目录 */
function getGlobalConfigDir(): string {
  return getGlobalCrabDir();
}

/** 获取敏感命令配置文件路径 */
function getConfigPath(scope: SensitiveCommandScope): string {
  if (scope === "global") {
    return path.join(getGlobalConfigDir(), "sensitive-commands.json");
  }
  return path.join(process.cwd(), ".crab", "sensitive-commands.json");
}

/** 加载指定作用域的配置 */
function loadScopedConfig(scope: SensitiveCommandScope): SensitiveCommandsConfig {
  const configPath = getConfigPath(scope);

  try {
    if (fs.existsSync(configPath)) {
      const data = JSON.parse(fs.readFileSync(configPath, "utf8"));
      const stored: StoredSensitiveCommand[] = Array.isArray(data.commands) ? data.commands : [];

      // 全局作用域:回填新增的预设命令(升级兼容)
      if (scope === "global") {
        const existingIds = new Set(stored.map((cmd) => cmd.id));
        const newPresets = PRESET_SENSITIVE_COMMANDS.filter((preset) => !existingIds.has(preset.id));
        if (newPresets.length > 0) {
          const merged = [...stored, ...newPresets];
          saveScopedConfig("global", { commands: merged });
          return { commands: merged };
        }
      }

      return { commands: stored };
    }
  } catch (error) {
    log.warn(`加载敏感命令配置失败 (${scope}): ${error}`);
  }

  // 未找到配置:全局用预设填充，项目为空
  if (scope === "global") {
    const defaultConfig: SensitiveCommandsConfig = {
      commands: [...PRESET_SENSITIVE_COMMANDS],
    };
    saveScopedConfig("global", defaultConfig);
    return defaultConfig;
  }
  return { commands: [] };
}

/** 保存指定作用域的配置 */
function saveScopedConfig(scope: SensitiveCommandScope, config: SensitiveCommandsConfig): void {
  try {
    const configPath = getConfigPath(scope);
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");
    invalidateSensitiveCommandCache();
  } catch (error) {
    log.error(`保存敏感命令配置失败 (${scope}): ${error}`);
  }
}

// ─── 公开 CRUD 接口 ──────────────────────────────────────

/** 加载全局敏感命令配置 */
export function loadSensitiveCommands(): SensitiveCommandsConfig {
  return loadScopedConfig("global");
}

/** 保存全局敏感命令配置 */
export function saveSensitiveCommands(config: SensitiveCommandsConfig): void {
  saveScopedConfig("global", config);
}

/** 获取所有敏感命令(合并 global + project) */
export function getAllSensitiveCommands(): SensitiveCommand[] {
  const globalConfig = loadScopedConfig("global");
  const projectConfig = loadScopedConfig("project");

  const globalCommands: SensitiveCommand[] = globalConfig.commands.map((cmd) => ({
    ...cmd,
    scope: "global" as const,
  }));
  const projectCommands: SensitiveCommand[] = projectConfig.commands.map((cmd) => ({
    ...cmd,
    scope: "project" as const,
  }));

  return [...globalCommands, ...projectCommands];
}

/** 添加自定义敏感命令 */
export function addSensitiveCommand(
  pattern: string,
  description: string,
  scope: SensitiveCommandScope = "global",
): void {
  // 检查重复
  const all = getAllSensitiveCommands();
  const duplicate = all.find((cmd) => cmd.pattern.trim() === pattern.trim());
  if (duplicate) {
    throw createInternalError("INTERNAL_ERROR", `DUPLICATE:${duplicate.scope}`);
  }

  const config = loadScopedConfig(scope);
  config.commands.push({
    description,
    enabled: true,
    id: prefixedId("custom"),
    isPreset: false,
    pattern,
  });
  saveScopedConfig(scope, config);
}

/** 删除敏感命令 */
export function removeSensitiveCommand(id: string, scope?: SensitiveCommandScope): void {
  if (scope) {
    const config = loadScopedConfig(scope);
    config.commands = config.commands.filter((cmd) => cmd.id !== id);
    saveScopedConfig(scope, config);
  } else {
    for (const s of ["global", "project"] as const) {
      const config = loadScopedConfig(s);
      const before = config.commands.length;
      config.commands = config.commands.filter((cmd) => cmd.id !== id);
      if (config.commands.length < before) {
        saveScopedConfig(s, config);
        return;
      }
    }
  }
}

/** 切换敏感命令启用/禁用 */
export function toggleSensitiveCommand(id: string, scope?: SensitiveCommandScope): void {
  const scopesToSearch: SensitiveCommandScope[] = scope ? [scope] : ["global", "project"];

  for (const s of scopesToSearch) {
    const config = loadScopedConfig(s);
    const command = config.commands.find((cmd) => cmd.id === id);

    if (command) {
      command.enabled = !command.enabled;
      saveScopedConfig(s, config);
      return;
    }
  }

  throw createInternalError("INTERNAL_ERROR", `敏感命令不存在: ${id}`);
}

/** 重置为默认预设 */
export function resetSensitiveCommands(scope?: SensitiveCommandScope): void {
  if (!scope || scope === "global") {
    saveScopedConfig("global", { commands: [...PRESET_SENSITIVE_COMMANDS] });
  }
  if (!scope || scope === "project") {
    saveScopedConfig("project", { commands: [] });
  }
}

/** 创建文件系统配置存储 */
export function createFileSensitiveCommandConfigStore(): ISensitiveCommandConfigStore {
  return { loadScopedConfig, saveScopedConfig };
}
