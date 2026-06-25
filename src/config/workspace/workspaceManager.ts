/**
 * Workspace 管理器 — 多工作区管理(P3-F8)
 *
 * 职责:
 *   - 列出所有已配置的工作区
 *   - 获取当前激活的工作区
 *   - 切换工作区（改变 cwd）
 *   - 添加/删除工作区
 *
 * 模块功能:
 *   - listWorkspaces: 列出所有工作区
 *   - getCurrentWorkspace: 获取当前工作区
 *   - switchWorkspace: 切换工作区
 *   - addWorkspace: 添加工作区
 *   - removeWorkspace: 删除工作区
 *
 * 使用场景:
 *   - 侧边栏工作区显示与切换
 *   - 底部状态栏工作区显示
 *   - 多项目快速切换
 *
 * 边界:
 *   1. 工作区配置存储在 AppConfigSchema.workspaces 中
 *   2. 切换工作区会改变 process.cwd()
 *   3. 当前工作区通过 currentWorkspaceId 标识
 *
 * 流程:
 *   1. 从配置读取工作区列表
 *   2. 根据 currentWorkspaceId 或 cwd 匹配当前工作区
 *   3. 切换时更新 cwd 和 currentWorkspaceId
 */
import process from "node:process";
import { createLogger } from "@/core/logging/logger";
import type { AppConfigSchema, WorkspaceConfig } from "@/schema/config";

const log = createLogger("config:workspace");

/** 默认工作区 ID */
const DEFAULT_WORKSPACE_ID = "default";

/**
 * 创建默认工作区（基于当前 cwd）。
 */
export function createDefaultWorkspace(): WorkspaceConfig {
  return {
    id: DEFAULT_WORKSPACE_ID,
    name: "默认",
    directory: process.cwd(),
    enabled: true,
  };
}

/**
 * 列出所有工作区。
 * 如果配置中没有工作区，返回包含默认工作区的数组。
 */
export function listWorkspaces(config: AppConfigSchema): WorkspaceConfig[] {
  const workspaces = config.workspaces ?? [];
  if (workspaces.length === 0) {
    return [createDefaultWorkspace()];
  }
  return workspaces.filter((ws) => ws.enabled);
}

/**
 * 获取当前工作区。
 * 优先根据 currentWorkspaceId 匹配，否则根据 cwd 匹配，最后返回默认工作区。
 */
export function getCurrentWorkspace(config: AppConfigSchema): WorkspaceConfig {
  const workspaces = listWorkspaces(config);

  // 1. 根据 currentWorkspaceId 匹配
  if (config.currentWorkspaceId) {
    const matched = workspaces.find((ws) => ws.id === config.currentWorkspaceId);
    if (matched) {
      return matched;
    }
  }

  // 2. 根据 cwd 匹配
  const cwd = process.cwd();
  const cwdMatched = workspaces.find((ws) => {
    try {
      return ws.directory === cwd;
    } catch {
      return false;
    }
  });
  if (cwdMatched) {
    return cwdMatched;
  }

  // 3. 返回默认工作区
  return createDefaultWorkspace();
}

/**
 * 切换工作区 — 改变 process.cwd() 到目标工作区目录。
 *
 * @param config - 当前配置
 * @param id - 目标工作区 ID
 * @returns 切换后的工作区配置，如果切换失败返回 undefined
 */
export function switchWorkspace(config: AppConfigSchema, id: string): WorkspaceConfig | undefined {
  const workspaces = listWorkspaces(config);
  const target = workspaces.find((ws) => ws.id === id);

  if (!target) {
    log.warn(`工作区 "${id}" 不存在`);
    return undefined;
  }

  if (!target.enabled) {
    log.warn(`工作区 "${id}" 已禁用`);
    return undefined;
  }

  try {
    process.chdir(target.directory);
    log.info(`已切换到工作区: ${target.name} (${target.directory})`);
    return target;
  } catch (error) {
    log.error(`切换工作区失败: ${(error as Error).message}`);
    return undefined;
  }
}

/**
 * 添加工作区到配置。
 *
 * @param config - 当前配置
 * @param workspace - 新工作区配置
 * @returns 更新后的配置
 */
export function addWorkspace(config: AppConfigSchema, workspace: WorkspaceConfig): AppConfigSchema {
  const workspaces = config.workspaces ?? [];
  // 检查 ID 唯一性
  if (workspaces.some((ws) => ws.id === workspace.id)) {
    log.warn(`工作区 ID "${workspace.id}" 已存在`);
    return config;
  }
  return {
    ...config,
    workspaces: [...workspaces, workspace],
  };
}

/**
 * 从配置中删除工作区。
 *
 * @param config - 当前配置
 * @param id - 要删除的工作区 ID
 * @returns 更新后的配置
 */
export function removeWorkspace(config: AppConfigSchema, id: string): AppConfigSchema {
  const workspaces = config.workspaces ?? [];
  const filtered = workspaces.filter((ws) => ws.id !== id);
  const currentId = config.currentWorkspaceId === id ? undefined : config.currentWorkspaceId;
  return {
    ...config,
    currentWorkspaceId: currentId,
    workspaces: filtered,
  };
}

/**
 * 获取工作区显示名称（包含目录缩略）。
 */
export function getWorkspaceDisplay(workspace: WorkspaceConfig): string {
  const dir = workspace.directory;
  const home = process.env.HOME ?? "";
  const shortDir = home && dir.startsWith(home) ? `~${dir.slice(home.length)}` : dir;
  return `${workspace.name} (${shortDir})`;
}

/**
 * 检查工作区目录是否有效。
 */
export function isWorkspaceValid(workspace: WorkspaceConfig): boolean {
  try {
    return workspace.directory.length > 0;
  } catch {
    return false;
  }
}
