/**
 * 配置路径解析。
 *
 * 职责:
 *   - 提供全局配置、项目配置的标准路径
 *   - 支持 XDG 规范
 *   - 向上查找项目配置
 *
 * 目录结构:
 *   ~/.crab/                  — 根目录
 *   ~/.crab/config.json       — 全局配置
 *   ~/.crab/mcp.json          — MCP 服务器配置
 *   ~/.crab/roles.json        — 角色定义
 *   ~/.crab/ROLE.md           — 全局角色指令
 *   ~/.crab/skills.json       — Skill 禁用列表
 *   ~/.crab/sensitive-commands.json — 敏感命令规则
 *   ~/.crab/auth/             — 认证数据
 *   ~/.crab/data/             — 运行时数据（数据库、会话、任务等）
 *   ~/.crab/logs/             — 运行日志
 *   ~/.crab/logs/audit/       — 审计日志
 *   ~/.crab/skills/           — Skill 文件
 *   ~/.crab/hooks/            — Hook 配置
 *   ~/.crab/themes/           — 自定义主题
 *   ~/.crab/agents/           — 生成的 Agent 定义
 *   ~/.crab/profiles/         — Profile 配置
 *   ~/.crab/tmp/              — 临时文件
 */
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

/** 全局 Crab 根目录:~/.crab */
export function getGlobalCrabDir(): string {
  return path.join(os.homedir(), ".crab");
}

/** 配置目录:~/.crab/（配置文件所在目录） */
export function getConfigDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg) {
    return path.join(xdg, "crab");
  }
  return getGlobalCrabDir();
}

/** 全局配置文件路径 */
export function getGlobalConfigPath(): string {
  return path.join(getConfigDir(), "config.json");
}

/** 全局 MCP 配置文件路径 */
export function getGlobalMcpConfigPath(): string {
  return path.join(getConfigDir(), "mcp.json");
}

/** 项目配置文件路径 — 向上查找 .crab/config.json */
export function getProjectConfigPath(cwd: string): string | null {
  let dir = path.resolve(cwd);
  for (;;) {
    const candidate = path.join(dir, ".crab", "config.json");
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return null;
}

/** 项目级 Crab 根目录。若未找到现成 .crab，则返回当前 cwd 下的目标路径。 */
export function getProjectCrabDir(cwd: string): string {
  let dir = path.resolve(cwd);
  while (dir !== "/") {
    const candidate = path.join(dir, ".crab");
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    dir = path.dirname(dir);
  }
  return path.join(path.resolve(cwd), ".crab");
}

/** 数据目录:~/.crab/data/（数据库、会话、任务等运行时数据） */
export function getDataDir(): string {
  const xdg = process.env.XDG_DATA_HOME;
  if (xdg) {
    return path.join(xdg, "crab");
  }
  return path.join(getGlobalCrabDir(), "data");
}

/** 认证目录:~/.crab/auth/（API token、OAuth 数据） */
export function getAuthDir(): string {
  return path.join(getGlobalCrabDir(), "auth");
}

/** 审计日志目录:~/.crab/logs/audit/ */
export function getAuditDir(): string {
  return path.join(getGlobalCrabDir(), "logs", "audit");
}

/** Profiles 目录:~/.crab/profiles/ */
export function getProfilesDir(): string {
  return path.join(getConfigDir(), "profiles");
}

/** Crab 根目录(别名，等同于 getConfigDir) */
export function getCrabDir(): string {
  return getConfigDir();
}

/** 全局 tmp 目录:~/.crab/tmp */
export function getGlobalTmpDir(): string {
  return path.join(getGlobalCrabDir(), "tmp");
}

/** 项目 tmp 目录:<project>/.crab/tmp */
export function getProjectTmpDir(cwd: string): string {
  return path.join(getProjectCrabDir(cwd), "tmp");
}
