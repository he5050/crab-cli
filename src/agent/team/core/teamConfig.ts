/**
 * [Team 配置管理]
 *
 * 职责:
 *   - 加载 Team 配置
 *   - 验证配置项有效性
 *   - 合并用户配置和默认配置
 *
 * 模块功能:
 *   - loadTeamConfig:加载配置(项目级优先，回退全局)
 *   - validateConfig:验证并合并配置
 *   - createDefaultConfig:创建默认配置
 *
 * 使用场景:
 *   - TeamExecutor 初始化时加载配置
 *   - 自定义团队行为参数
 *   - 项目级和全局配置管理
 *
 * 边界:
 *   1. 配置来源:.crab/team.json 或 ~/.crab/team.json
 *   2. 项目级配置优先于全局配置
 *   3. 无效配置项使用默认值
 *   4. maxTeammates 上限为 20
 *
 * 流程:
 *   1. 按优先级查找配置文件
 *   2. 解析 JSON 配置
 *   3. 验证并合并默认配置
 *   4. 返回完整的 TeamConfig 对象
 */
import type { TeamConfig } from "../types";
import { DEFAULT_TEAM_CONFIG } from "../types";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { createLogger } from "@/core/logging/logger";

const log = createLogger("team:config");

/** 加载 Team 配置(项目级优先，回退到全局) */
export function loadTeamConfig(projectDir?: string): TeamConfig {
  const configPaths: string[] = [];
  if (projectDir) {
    configPaths.push(join(projectDir, ".crab", "team.json"));
  }
  configPaths.push(join(homedir(), ".crab", "team.json"));

  for (const path of configPaths) {
    if (!existsSync(path)) {
      continue;
    }
    try {
      const data = JSON.parse(readFileSync(path, "utf8"));
      return validateConfig(data);
    } catch {
      log.warn(`Team 配置文件解析失败: ${path}`);
    }
  }

  return { ...DEFAULT_TEAM_CONFIG };
}

/** 验证并合并用户配置 */
function validateConfig(data: Record<string, unknown>): TeamConfig {
  return {
    autoApprove: typeof data.autoApprove === "boolean" ? data.autoApprove : DEFAULT_TEAM_CONFIG.autoApprove,
    doomLoopThreshold:
      typeof data.doomLoopThreshold === "number" && data.doomLoopThreshold > 0
        ? Math.floor(data.doomLoopThreshold)
        : DEFAULT_TEAM_CONFIG.doomLoopThreshold,
    maxTeammates:
      typeof data.maxTeammates === "number" && data.maxTeammates > 0
        ? Math.min(data.maxTeammates, 20)
        : DEFAULT_TEAM_CONFIG.maxTeammates,
    useWorktree: typeof data.useWorktree === "boolean" ? data.useWorktree : DEFAULT_TEAM_CONFIG.useWorktree,
    worktreeBase: typeof data.worktreeBase === "string" ? data.worktreeBase : DEFAULT_TEAM_CONFIG.worktreeBase,
  };
}

/** 创建默认配置 */
export function createDefaultConfig(): TeamConfig {
  return { ...DEFAULT_TEAM_CONFIG };
}
